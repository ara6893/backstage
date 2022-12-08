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
import {
  Project,
  SyntaxKind,
  ts,
  Node,
  Expression,
  Identifier,
} from 'ts-morph';

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

function printNode(node?: Node<ts.Node>) {
  console.log(`${node?.getText()} ${node?.getKindName()}`);
}

function getImportReference(node?: Identifier) {
  return node
    ?.findReferences()
    .flatMap(e => e.getReferences().map(f => getImportDeclaration(f.getNode())))
    .filter(e => e);
}

function getImportDeclarationFromFunctionCall(node?: Node<ts.Node>) {
  const routerCall = node?.getChildAtIndexIfKind(1, SyntaxKind.CallExpression);
  console.log('routerCall');
  printNode(routerCall);
  const routerRef = routerCall?.getChildAtIndexIfKind(0, SyntaxKind.Identifier);
  console.log('routerREf');
  printNode(routerRef);
  return getImportReference(routerRef)?.[0];
}

function getParentOfKind(node?: Node, kind?: SyntaxKind) {
  let curr = node;
  while (curr && !curr?.isKind(kind!)) {
    console.log('while');
    printNode(curr);
    curr = curr.getParent();
  }
  printNode(curr);
  return curr;
}

function getFunctionIdentifier(node?: Expression) {
  printNode(node);
  let retVal = node;
  if (retVal?.isKind(SyntaxKind.AwaitExpression)) {
    retVal = retVal.getExpression();
  }
  if (retVal?.isKind(SyntaxKind.CallExpression)) {
    retVal = retVal?.getExpression();
  }
  if (retVal?.isKind(SyntaxKind.PropertyAccessExpression)) {
    retVal = retVal?.getExpression();
  }
  printNode(retVal);
  return retVal?.asKind(SyntaxKind.Identifier);
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
  let returnIdentifier = getFunctionIdentifier(
    returnStatement?.getExpression(),
  );
  const references = returnIdentifier?.findReferences().flatMap(e =>
    e
      .getReferences()
      ?.map(f => f.getNode())
      .filter(f => f.isKind(SyntaxKind.ImportDeclaration)),
  );

  let reference;

  if (references?.length === 0) {
    printNode(returnIdentifier);
    printNode(returnIdentifier?.getParent());
    if (!returnIdentifier?.getParent()?.isKind(SyntaxKind.CallExpression)) {
      console.log('not a raw expression.');
      let i = 0;
      do {
        const refs = returnIdentifier
          ?.findReferences()
          .flatMap(e =>
            e
              .getReferences()
              ?.map(f =>
                getParentOfKind(f.getNode(), SyntaxKind.VariableDeclaration),
              ),
          )
          .filter(e => e);
        returnIdentifier = refs
          ?.map(e =>
            getFunctionIdentifier(
              e?.asKind(SyntaxKind.VariableDeclaration)?.getInitializer(),
            ),
          )
          .find(e => e);
        reference = getImportReference(returnIdentifier)?.[0];
        i += 1;
        if (i > 3) break;
      } while (!reference);
    } else {
      reference = getImportDeclarationFromFunctionCall(
        returnIdentifier?.getParent()?.getParent(),
      );
    }
  } else {
    reference = references?.[0];
  }
  const importDeclaration = reference?.asKind(SyntaxKind.ImportDeclaration);
  return importDeclaration;
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
        .map(f => f.getNode())
        .map(f => {
          const parent = f.getParent()?.getParent();
          console.log(`${parent?.getText()} ${parent?.getKindName()}`);
          return f;
        })
        .filter(f => f.getParent()?.getText() === 'apiRouter.use'),
    )
    .map(e => e.getParent()?.getParent()?.asKind(SyntaxKind.CallExpression))
    .filter(e => e);

  const routes: { [key: string]: { moduleName: string; sourceFile: string } } =
    {};

  routerUses?.forEach(e => {
    if (e?.getArguments().length !== 2) return;
    const routeName = e?.getArguments()[0].getText().replace(/['"]+/g, '');
    const module = getMappedModule(e.getArguments()[1]);
    if (routeName && module) {
      routes[routeName] = {
        moduleName: module?.getModuleSpecifierValue(),
        sourceFile: module?.getModuleSpecifierSourceFile()?.getFilePath()!,
      };
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
    .getText()
    .replace(/['"]+/g, '');

  if (mainRouteName) {
    return { [mainRouteName]: routes };
  }
  console.error('Unable to read the given files.');
  return undefined;
}
