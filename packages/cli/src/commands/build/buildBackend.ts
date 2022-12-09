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

import os from 'os';
import fs from 'fs-extra';
import { resolve as resolvePath } from 'path';
import tar, { CreateOptions } from 'tar';
import { createDistWorkspace } from '../../lib/packager';
import { getEnvironmentParallelism } from '../../lib/parallel';
import { buildPackage, Output } from '../../lib/builder';
import getRouteMappings from '../openapi/route-mapping';
import { merge, isErrorResult } from 'openapi-merge';
import SwaggerParser from '@apidevtools/swagger-parser';
import { findPaths } from '@backstage/cli-common';
import yaml from 'yaml';
import { paths } from '../../lib/paths';

const BUNDLE_FILE = 'bundle.tar.gz';
const SKELETON_FILE = 'skeleton.tar.gz';

interface BuildBackendOptions {
  targetDir: string;
  skipBuildDependencies: boolean;
}

async function getOpenApiSpec(module: {
  moduleName: string;
  sourceFile: string;
}) {
  if (!module || !module.sourceFile) return undefined;
  const paths = findPaths(module.sourceFile);
  const openApiFile = paths.resolveOwn('openapi.yaml');
  console.log(openApiFile);
  try {
    return (await SwaggerParser.bundle(openApiFile)) as any;
  } catch (err) {
    if (!(err?.message as string)?.includes('Error opening file'))
      console.error(err);
    return undefined;
  }
}

export async function buildBackend(options: BuildBackendOptions) {
  const { targetDir, skipBuildDependencies } = options;
  const pkg = await fs.readJson(resolvePath(targetDir, 'package.json'));

  const routeMappings = getRouteMappings({
    tsConfigFilePath: '../../tsconfig.json',
    backendDirectory: targetDir,
  });
  console.log(routeMappings);
  if (routeMappings) {
    const routes = await Promise.all(
      Object.keys(routeMappings).map(async topLevelRoute => {
        const apis = merge(
          (
            await Promise.all(
              Object.keys(routeMappings[topLevelRoute]).map(async route => {
                const module = routeMappings[topLevelRoute][route];
                return {
                  oas: await getOpenApiSpec(module),
                  pathModification: {
                    prepend: route,
                  },
                };
              }),
            )
          ).filter(e => e.oas),
        );
        if (isErrorResult(apis)) {
          // Oops, something went wrong
          console.error(`${apis.message} (${apis.type})`);
        } else {
          // /api
          const routeDefinition = merge([
            {
              oas: apis.output,
              pathModification: {
                prepend: topLevelRoute,
              },
            },
          ]);
          if (isErrorResult(routeDefinition)) {
            console.error(
              `${routeDefinition.message} (${routeDefinition.type})`,
            );
          } else {
            return routeDefinition.output;
          }
        }
        return undefined;
      }),
    );
    const fullSpec = merge(routes.filter(e => e).map(e => ({ oas: e! })));
    if (isErrorResult(fullSpec)) {
      console.error(fullSpec.message);
    } else {
      fs.writeFileSync(
        paths.resolveOwnRoot('openapi.yaml'),
        yaml.stringify(yaml.parse(JSON.stringify(fullSpec.output))),
      );
    }
  }

  return;

  // We build the target package without generating type declarations.
  await buildPackage({
    targetDir: options.targetDir,
    outputs: new Set([Output.cjs]),
  });

  const tmpDir = await fs.mkdtemp(resolvePath(os.tmpdir(), 'backstage-bundle'));
  try {
    await createDistWorkspace([pkg.name], {
      targetDir: tmpDir,
      buildDependencies: !skipBuildDependencies,
      buildExcludes: [pkg.name],
      parallelism: getEnvironmentParallelism(),
      skeleton: SKELETON_FILE,
    });

    // We built the target backend package using the regular build process, but the result of
    // that has now been packed into the dist workspace, so clean up the dist dir.
    const distDir = resolvePath(targetDir, 'dist');
    await fs.remove(distDir);
    await fs.mkdir(distDir);

    // Move out skeleton.tar.gz before we create the main bundle, no point having that included up twice.
    await fs.move(
      resolvePath(tmpDir, SKELETON_FILE),
      resolvePath(distDir, SKELETON_FILE),
    );

    // Create main bundle.tar.gz, with some tweaks to make it more likely hit Docker build cache.
    await tar.create(
      {
        file: resolvePath(distDir, BUNDLE_FILE),
        cwd: tmpDir,
        portable: true,
        noMtime: true,
        gzip: true,
      } as CreateOptions & { noMtime: boolean },
      [''],
    );
  } finally {
    await fs.remove(tmpDir);
  }
}
