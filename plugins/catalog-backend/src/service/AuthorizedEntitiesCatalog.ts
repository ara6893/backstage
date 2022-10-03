/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NotAllowedError } from '@backstage/errors';
import {
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
} from '@backstage/plugin-catalog-common';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  AuthorizePermissionRequest,
  AuthorizeResult,
  EvaluatePermissionRequest,
  EvaluatePermissionResponse,
  PermissionEvaluator,
} from '@backstage/plugin-permission-common';
import { ConditionTransformer } from '@backstage/plugin-permission-node';
import {
  EntitiesCatalog,
  EntitiesRequest,
  EntitiesResponse,
  EntityAncestryResponse,
  EntityFacetsRequest,
  EntityFacetsResponse,
  EntityFilter,
} from '../catalog/types';
import { basicEntityFilter } from './request/basicEntityFilter';
import { compact } from 'lodash';
import DataLoader from 'dataloader';
import QueryString from 'qs';

export class AuthorizedEntitiesCatalog implements EntitiesCatalog {
  constructor(
    private readonly entitiesCatalog: EntitiesCatalog,
    private readonly permissionApi: PermissionEvaluator,
    private readonly transformConditions: ConditionTransformer<EntityFilter>,
  ) {}

  async entities(request?: EntitiesRequest): Promise<EntitiesResponse> {
    const authorizationOptions = { token: request?.authorizationToken };
    const authorizeDecision = (
      await this.permissionApi.authorizeConditional(
        [{ permission: catalogEntityReadPermission }],
        authorizationOptions,
      )
    )[0];

    if (authorizeDecision.result === AuthorizeResult.DENY) {
      return {
        entities: [],
        pageInfo: { hasNextPage: false },
      };
    }

    const authorizer = new DataLoader(
      (requests: readonly AuthorizePermissionRequest[]) =>
        this.permissionApi.authorize(requests.slice(), authorizationOptions),
      {
        // Serialize the permission name and resourceRef as
        // a query string to avoid collisions from overlapping
        // permission names and resourceRefs.
        cacheKeyFn: ({ permission: { name }, resourceRef }) =>
          QueryString.stringify({ name, resourceRef }),
      },
    );

    if (authorizeDecision.result === AuthorizeResult.CONDITIONAL) {
      const permissionFilter: EntityFilter = this.transformConditions(
        authorizeDecision.conditions,
      );
      return this.filterResults(
        await this.entitiesCatalog.entities({
          ...request,
          filter: request?.filter
            ? { allOf: [permissionFilter, request.filter] }
            : permissionFilter,
        }),
        authorizer,
      );
    }

    return this.filterResults(
      await this.entitiesCatalog.entities(request),
      authorizer,
    );
  }

  async removeEntityByUid(
    uid: string,
    options?: { authorizationToken?: string },
  ): Promise<void> {
    const authorizeResponse = (
      await this.permissionApi.authorizeConditional(
        [{ permission: catalogEntityDeletePermission }],
        { token: options?.authorizationToken },
      )
    )[0];
    if (authorizeResponse.result === AuthorizeResult.DENY) {
      throw new NotAllowedError();
    }
    if (authorizeResponse.result === AuthorizeResult.CONDITIONAL) {
      const permissionFilter: EntityFilter = this.transformConditions(
        authorizeResponse.conditions,
      );
      const { entities } = await this.entitiesCatalog.entities({
        filter: {
          allOf: [permissionFilter, basicEntityFilter({ 'metadata.uid': uid })],
        },
      });
      if (entities.length === 0) {
        throw new NotAllowedError();
      }
    }
    return this.entitiesCatalog.removeEntityByUid(uid);
  }

  async entityAncestry(
    entityRef: string,
    options?: { authorizationToken?: string },
  ): Promise<EntityAncestryResponse> {
    const rootEntityAuthorizeResponse = (
      await this.permissionApi.authorize(
        [{ permission: catalogEntityReadPermission, resourceRef: entityRef }],
        { token: options?.authorizationToken },
      )
    )[0];
    if (rootEntityAuthorizeResponse.result === AuthorizeResult.DENY) {
      throw new NotAllowedError();
    }

    const ancestryResult = await this.entitiesCatalog.entityAncestry(entityRef);
    const authorizeResponse = await this.permissionApi.authorize(
      ancestryResult.items.map(item => ({
        permission: catalogEntityReadPermission,
        resourceRef: stringifyEntityRef(item.entity),
      })),
      { token: options?.authorizationToken },
    );
    const unauthorizedAncestryItems = ancestryResult.items.filter(
      (_, index) => authorizeResponse[index].result === AuthorizeResult.DENY,
    );
    if (unauthorizedAncestryItems.length === 0) {
      return ancestryResult;
    }
    const rootUnauthorizedEntityRefs = unauthorizedAncestryItems.map(
      ancestryItem => stringifyEntityRef(ancestryItem.entity),
    );
    const allUnauthorizedEntityRefs = new Set(
      rootUnauthorizedEntityRefs.flatMap(rootEntityRef =>
        this.findParents(
          rootEntityRef,
          ancestryResult.items,
          new Set(rootUnauthorizedEntityRefs),
        ),
      ),
    );
    return {
      rootEntityRef: ancestryResult.rootEntityRef,
      items: ancestryResult.items.filter(
        ancestryItem =>
          !allUnauthorizedEntityRefs.has(
            stringifyEntityRef(ancestryItem.entity),
          ),
      ),
    };
  }

  async facets(request: EntityFacetsRequest): Promise<EntityFacetsResponse> {
    const authorizeDecision = (
      await this.permissionApi.authorizeConditional(
        [{ permission: catalogEntityReadPermission }],
        { token: request?.authorizationToken },
      )
    )[0];

    if (authorizeDecision.result === AuthorizeResult.DENY) {
      return {
        facets: Object.fromEntries(request.facets.map(f => [f, []])),
      };
    }

    if (authorizeDecision.result === AuthorizeResult.CONDITIONAL) {
      const permissionFilter: EntityFilter = this.transformConditions(
        authorizeDecision.conditions,
      );
      return this.entitiesCatalog.facets({
        ...request,
        filter: request?.filter
          ? { allOf: [permissionFilter, request.filter] }
          : permissionFilter,
      });
    }

    return this.entitiesCatalog.facets(request);
  }

  private findParents(
    entityRef: string,
    allAncestryItems: { entity: Entity; parentEntityRefs: string[] }[],
    seenEntityRefs: Set<string>,
  ): string[] {
    const entity = allAncestryItems.find(
      ancestryItem => stringifyEntityRef(ancestryItem.entity) === entityRef,
    );
    if (!entity) return [];

    const newSeenEntityRefs = new Set(seenEntityRefs);
    entity.parentEntityRefs.forEach(parentRef =>
      newSeenEntityRefs.add(parentRef),
    );

    return [
      entityRef,
      ...entity.parentEntityRefs.flatMap(parentRef =>
        seenEntityRefs.has(parentRef)
          ? []
          : this.findParents(parentRef, allAncestryItems, newSeenEntityRefs),
      ),
    ];
  }

  /**
   * Filter the returned database results to just those that match the authorizer's
   *  rules.
   * @param results Database query results.
   * @param authorizer DataLoader for the authorization.
   * @returns Results with invalid results parsed out.
   */
  private async filterResults(
    results: EntitiesResponse,
    authorizer: DataLoader<
      EvaluatePermissionRequest,
      EvaluatePermissionResponse
    >,
  ) {
    const entities = compact(
      await Promise.all(
        results.entities.map(entity => {
          return authorizer
            .load({
              resourceRef: stringifyEntityRef(entity),
              permission: catalogEntityReadPermission,
            })
            .then(decision =>
              decision.result === AuthorizeResult.ALLOW ? entity : undefined,
            );
        }),
      ),
    );
    return {
      entities,
      pageInfo: results.pageInfo,
    };
  }
}
