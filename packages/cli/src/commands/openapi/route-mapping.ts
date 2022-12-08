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
import { Project, SyntaxKind, ts, Node } from 'ts-morph';

interface RouteMappingOptions {
  tsConfigFilePath: string;
  backendDirectory: string;
}

function getImportDeclaration(node?: Node<ts.Node>) {
  let importDeclaration = node?.getParent()?.getParent();
  if (importDeclaration?.isKind(SyntaxKind.NamedImports)) {
    importDeclaration = importDeclaration.getParent();
  }
  if (importDeclaration?.isKind(SyntaxKind.ImportClause)) {
    importDeclaration = importDeclaration?.getParent();
  }
  if (importDeclaration?.isKind(SyntaxKind.ImportDeclaration)) {
    return importDeclaration;
  }
  return undefined;
}

function getImportDeclarationFromFunctionCall(node?: Node<ts.Node>) {
  const routerCall = node?.getChildAtIndexIfKind(1, SyntaxKind.CallExpression);
  const routerRef = routerCall?.getChildAtIndexIfKind(0, SyntaxKind.Identifier);
  return routerRef
    ?.findReferences()
    .flatMap(e => e.getReferences().map(f => getImportDeclaration(f.getNode())))
    .filter(e => e)[0];
}

function getMappedModule(node?: Node<ts.Node>) {
  const importRef = getImportDeclarationFromFunctionCall(node);
  const otherFile = importRef?.getModuleSpecifierSourceFile();
  const defaultExport = otherFile
    ?.getDefaultExportSymbol()
    ?.getValueDeclaration()
    ?.asKindOrThrow(SyntaxKind.FunctionDeclaration);
  const moduleBody = defaultExport?.getBody()?.asKindOrThrow(SyntaxKind.Block);
  console.log(moduleBody?.getText());
  const returnStatement = moduleBody?.getChildrenOfKind(
    SyntaxKind.ReturnStatement,
  )[0];
  let returnExpression = returnStatement?.getExpression();
  if (returnExpression?.isKind(SyntaxKind.AwaitExpression)) {
    returnExpression = returnExpression.getExpression();
  }
  if (returnExpression?.isKind(SyntaxKind.CallExpression)) {
    returnExpression = returnExpression?.getExpression();
  }
  const returnIdentifier = returnExpression?.asKind(SyntaxKind.Identifier);
  const references = returnIdentifier?.findReferences().flatMap(e =>
    e
      .getReferences()
      ?.map(f => f.getNode())
      .filter(f => f.isKind(SyntaxKind.ImportDeclaration)),
  );

  let reference;

  if (references?.length === 0) {
    reference = getImportDeclarationFromFunctionCall(
      returnIdentifier?.getParent()?.getParent(),
    );
  } else {
    reference = references?.[0];
  }
  const moduleSpecifier = reference
    ?.asKind(SyntaxKind.ImportDeclaration)
    ?.getModuleSpecifierValue();
  return moduleSpecifier;
}

/**
 * 
 * @param param0 
 * @returns Something like {
  "'/api'": {
    "'/code-coverage'": '@backstage/plugin-code-coverage-backend',
    "'/rollbar'": '@backstage/plugin-rollbar-backend',
    "'/scaffolder'": '@backstage/plugin-scaffolder-backend',
    "'/tech-insights'": '@backstage/plugin-tech-insights-backend',
    "'/auth'": '@backstage/plugin-auth-backend',
    "'/azure-devops'": '@backstage/plugin-azure-devops-backend',
    "'/search'": '@backstage/plugin-search-backend',
    "'/techdocs'": '@backstage/plugin-techdocs-backend',
    "'/todo'": '@backstage/plugin-todo-backend',
    "'/kafka'": '@backstage/plugin-kafka-backend',
    "'/proxy'": '@backstage/plugin-proxy-backend',
    "'/graphql'": '@backstage/plugin-graphql-backend',
    "'/badges'": '@backstage/plugin-badges-backend',
    "'/jenkins'": '@backstage/plugin-jenkins-backend',
    "'/permission'": '@backstage/plugin-permission-backend',
    "'/playlist'": '@backstage/plugin-playlist-backend',
    "'/explore'": '@backstage/plugin-explore-backend'
  }
}
 */
export default function getRouteMappings({
  tsConfigFilePath,
  backendDirectory,
}: RouteMappingOptions) {
  const project = new Project({
    tsConfigFilePath,
  });
  const backendIndexFile = project
    .getDirectory(backendDirectory)
    ?.getSourceFile('src/index.ts');

  let mainFunction = backendIndexFile?.getFunction('main');
  if (!mainFunction) {
    mainFunction = backendIndexFile?.getFunctions()[0];
  }

  const router = mainFunction?.getVariableDeclaration('apiRouter');

  const routerUses = router
    ?.findReferences()
    .flatMap(e =>
      e
        .getReferences()
        .filter(f => f.getNode().getParent()?.getText() === 'apiRouter.use'),
    )
    .map(e =>
      e.getNode().getParent()?.getParent()?.asKind(SyntaxKind.CallExpression),
    )
    .filter(e => e);

  const routes: { [key: string]: string } = {};

  routerUses?.map(e => {
    if (e?.getArguments().length !== 2) return;
    const routeName = e?.getArguments()[0].getText();
    const moduleName = getMappedModule(e.getArguments()[1]);
    if (routeName && moduleName) {
      routes[routeName] = moduleName;
    }
  });

  const mainRoute = router
    ?.findReferences()
    .flatMap(e =>
      e
        .getReferences()
        .map(f => f.getNode())
        .filter(f => f.getParent()?.getText() !== 'apiRouter.use'),
    )
    .map(e => e.getParent())
    .find(e => e && e.isKind(SyntaxKind.CallExpression));
  const mainRouteName = mainRoute
    ?.asKind(SyntaxKind.CallExpression)
    ?.getArguments()[0]
    .getText();

  if (mainRouteName) {
    return { [mainRouteName]: routes };
  }
  console.error('Unable to read the given files.');
  return undefined;
}
