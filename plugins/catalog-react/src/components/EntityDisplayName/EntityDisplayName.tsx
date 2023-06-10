/*
 * Copyright 2023 The Backstage Authors
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

import { CompoundEntityRef, Entity } from '@backstage/catalog-model';
import { useEntityPresentation } from '../../apis';

/**
 * The available style class keys for {@link EntityDisplayName}, under the name
 * "CatalogReactEntityDisplayName".
 *
 * @public
 */
export type CatalogReactEntityDisplayNameClassKey = 'root' | 'icon';

/**
 * Props for {@link EntityDisplayName}.
 *
 * @public
 */
export type EntityDisplayNameProps = {
  entityRef: Entity | CompoundEntityRef | string;
  variant?: 'simple' | 'popover' | string;
  defaultKind?: string;
  defaultNamespace?: string;
  includeIcon?: boolean;
};

/**
 * Shows a nice representation of a reference to an entity.
 *
 * @public
 */
export const EntityDisplayName = (
  props: EntityDisplayNameProps,
): JSX.Element => {
  const { entityRef, variant, defaultKind, defaultNamespace, includeIcon } =
    props;

  const Name = useEntityPresentation(entityRef, {
    defaultKind,
    defaultNamespace,
    variant,
    includeIcon,
  });

  return Name;
};
