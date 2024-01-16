/*
 * Copyright 2020 The Backstage Authors
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

import { EntityPolicy } from './types';
import {
  CommonValidatorFunctions,
  KubernetesValidatorFunctions,
  makeValidator,
  Validators,
} from '../../validation';
import { Entity } from '../Entity';
import { FieldError } from '@backstage/errors';

/**
 * Ensures that the format of individual fields of the entity envelope
 * is valid.
 *
 * @remarks
 *
 * This does not take into account machine generated fields such as uid and etag.
 *
 * @public
 */
export class FieldFormatEntityPolicy implements EntityPolicy {
  private readonly validators: Validators;

  constructor(validators: Validators = makeValidator()) {
    this.validators = validators;
  }

  async enforce(entity: Entity): Promise<Entity> {
    function require(
      field: string,
      value: any,
      validator: (value: any) => boolean,
    ) {
      if (value === undefined || value === null) {
        throw new Error(`${field} must have a value`);
      }

      let isValid: boolean;
      try {
        isValid = validator(value);
      } catch (e) {
        throw new Error(`${field} could not be validated, ${e}`);
      }

      if (!isValid) {
        let expectation;
        switch (
          validator.name as
            | keyof typeof KubernetesValidatorFunctions
            | keyof typeof CommonValidatorFunctions
        ) {
          case 'isValidLabelValue':
          case 'isValidObjectName':
            expectation =
              'a string that is sequences of [a-zA-Z0-9] separated by any of [-_.], at most 63 characters in total';
            break;
          case 'isValidLabelKey':
          case 'isValidApiVersion':
          case 'isValidAnnotationKey':
            expectation = 'a valid prefix and/or suffix';
            break;
          case 'isValidNamespace':
          case 'isValidDnsLabel':
            expectation =
              'a string that is sequences of [a-z0-9] separated by [-], at most 63 characters in total';
            break;
          case 'isValidTag':
            expectation =
              'a string that is sequences of [a-z0-9+#] separated by [-], at most 63 characters in total';
            break;
          case 'isValidAnnotationValue':
            expectation = 'a string';
            break;
          case 'isValidKind':
            expectation =
              'a string that is a sequence of [a-zA-Z][a-z0-9A-Z], at most 63 characters in total';
            break;
          case 'isValidUrl':
            expectation = 'a string that is a valid url';
            break;
          case 'isValidString':
          case 'isNonEmptyString':
            expectation = 'a non empty string';
            break;
          default:
            expectation = undefined;
            break;
        }

        // ensure that if there are other/future validators, the error message defaults to a general "is not valid, visit link"
        const message = expectation
          ? ` expected ${expectation} but found "${value}".`
          : '';

        throw FieldError.fromDotFormat(
          field,
          `"${field}" is not valid;${message} To learn more about catalog file format, visit: https://github.com/backstage/backstage/blob/master/docs/architecture-decisions/adr002-default-catalog-file-format.md`,
        );
      }
    }

    function optional(
      field: string,
      value: any,
      validator: (value: any) => boolean,
    ) {
      return value === undefined || require(field, value, validator);
    }

    require('apiVersion', entity.apiVersion, this.validators.isValidApiVersion);
    require('kind', entity.kind, this.validators.isValidKind);

    require('metadata.name', entity.metadata.name, this.validators
      .isValidEntityName);
    optional(
      'metadata.namespace',
      entity.metadata.namespace,
      this.validators.isValidNamespace,
    );

    for (const [k, v] of Object.entries(entity.metadata.labels ?? [])) {
      require(`metadata.labels.${k}`, k, this.validators.isValidLabelKey);
      require(`metadata.labels.${k}`, v, this.validators.isValidLabelValue);
    }

    for (const [k, v] of Object.entries(entity.metadata.annotations ?? [])) {
      require(`metadata.annotations.${k}`, k, this.validators
        .isValidAnnotationKey);
      require(`metadata.annotations.${k}`, v, this.validators
        .isValidAnnotationValue);
    }

    const tags = entity.metadata.tags ?? [];

    for (let i = 0; i < tags.length; ++i) {
      require(`metadata.tags.${i}`, tags[i], this.validators.isValidTag);
    }

    const links = entity.metadata.links ?? [];

    for (let i = 0; i < links.length; ++i) {
      require(`metadata.links.${i}.url`, links[i]
        ?.url, CommonValidatorFunctions.isValidUrl);
      optional(
        `metadata.links.${i}.title`,
        links[i]?.title,
        CommonValidatorFunctions.isNonEmptyString,
      );
      optional(
        `metadata.links.${i}.icon`,
        links[i]?.icon,
        KubernetesValidatorFunctions.isValidObjectName,
      );
    }

    return entity;
  }
}
