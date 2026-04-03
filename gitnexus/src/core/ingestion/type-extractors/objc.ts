import type { ClassNameLookup, ConstructorBindingScanner, ConstructorTypeDetector, InitializerExtractor, LanguageTypeConfig, ParameterExtractor, PendingAssignmentExtractor, TypeBindingExtractor } from './types.js';
import { extractSimpleTypeName, extractVarName } from './shared.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';

const DECLARATION_NODE_TYPES: ReadonlySet<string> = new Set([
  'declaration',
  'property_declaration',
  'instance_variable',
]);

const unwrapDeclarator = (node: SyntaxNode | null): SyntaxNode | null => {
  let current = node;
  while (current) {
    if (current.type === 'init_declarator') {
      current = current.childForFieldName('declarator');
      continue;
    }
    if (current.type === 'pointer_declarator' || current.type === 'reference_declarator'
      || current.type === 'parenthesized_declarator') {
      current = current.firstNamedChild;
      continue;
    }
    return current;
  }
  return null;
};

const extractObjcTypeName = (node: SyntaxNode | null): string | undefined => {
  if (!node) return undefined;

  const direct = extractSimpleTypeName(node);
  if (direct) return direct;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    const nested = extractSimpleTypeName(child);
    if (nested) return nested;
  }

  return node.text.replace(/\s+/g, '').match(/[A-Z_]\w*/)?.[0];
};

const extractStructDeclarationBinding = (node: SyntaxNode, env: Map<string, string>): void => {
  const structDecl = node.namedChildren.find((child) => child.type === 'struct_declaration');
  if (!structDecl) return;

  const typeName = extractObjcTypeName(structDecl.childForFieldName('type'));
  if (!typeName) return;

  const declarator = unwrapDeclarator(structDecl.childForFieldName('declarator') ?? structDecl.lastNamedChild);
  const varName = declarator ? (extractVarName(declarator) ?? declarator.text) : undefined;
  if (varName) env.set(varName, typeName);
};

const extractDeclaration: TypeBindingExtractor = (node: SyntaxNode, env: Map<string, string>): void => {
  if (node.type === 'declaration') {
    const typeName = extractObjcTypeName(node.childForFieldName('type'));
    if (!typeName) return;

    const declarator = unwrapDeclarator(node.childForFieldName('declarator'));
    const varName = declarator ? extractVarName(declarator) : undefined;
    if (varName) env.set(varName, typeName);
    return;
  }

  if (node.type === 'property_declaration' || node.type === 'instance_variable') {
    extractStructDeclarationBinding(node, env);
  }
};

const extractParameter: ParameterExtractor = (node: SyntaxNode, env: Map<string, string>): void => {
  if (node.type === 'method_parameter') {
    const typeName = extractObjcTypeName(node.childForFieldName('type') ?? node.namedChildren.find((child) => child.type === 'method_type') ?? null);
    if (!typeName) return;

    const declarator = unwrapDeclarator(node.childForFieldName('declarator'));
    let varName = declarator ? extractVarName(declarator) : undefined;
    if (!varName) {
      const identifiers = node.namedChildren.filter((child) => child.type === 'identifier');
      varName = identifiers.length > 0 ? identifiers[identifiers.length - 1].text : undefined;
    }
    if (varName) env.set(varName, typeName);
    return;
  }

  if (node.type === 'parameter_declaration') {
    const typeName = extractObjcTypeName(node.childForFieldName('type'));
    if (!typeName) return;
    const declarator = unwrapDeclarator(node.childForFieldName('declarator'));
    const varName = declarator ? extractVarName(declarator) : undefined;
    if (varName) env.set(varName, typeName);
  }
};

const getMessageMethods = (node: SyntaxNode): string[] => {
  const methods: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') methods.push(child.text);
  }
  return methods;
};

const getMessageReceiverType = (receiver: SyntaxNode | null, classNames: ClassNameLookup): string | undefined => {
  if (!receiver) return undefined;
  if (receiver.type === 'identifier') {
    return classNames.has(receiver.text) ? receiver.text : undefined;
  }
  if (receiver.type === 'generic_specifier') {
    const typeName = extractObjcTypeName(receiver);
    return typeName && classNames.has(typeName) ? typeName : undefined;
  }
  return undefined;
};

const detectObjcConstructorType = (node: SyntaxNode | null, classNames: ClassNameLookup): string | undefined => {
  if (!node || node.type !== 'message_expression') return undefined;

  const methods = getMessageMethods(node);
  const receiver = node.childForFieldName('receiver');

  const directType = getMessageReceiverType(receiver, classNames);
  if (directType && methods.some((method) => method === 'new' || method.startsWith('alloc'))) {
    return directType;
  }

  if (receiver?.type === 'message_expression') {
    const innerMethods = getMessageMethods(receiver);
    const innerType = getMessageReceiverType(receiver.childForFieldName('receiver'), classNames);
    if (innerType && innerMethods.some((method) => method === 'new' || method.startsWith('alloc'))
      && methods.some((method) => method.startsWith('init'))) {
      return innerType;
    }
  }

  return undefined;
};

const extractInitializer: InitializerExtractor = (node, env, classNames) => {
  if (node.type !== 'declaration') return;

  const declarator = node.childForFieldName('declarator');
  if (!declarator || declarator.type !== 'init_declarator') return;

  const value = declarator.childForFieldName('value');
  const nameNode = unwrapDeclarator(declarator.childForFieldName('declarator'));
  const varName = nameNode ? extractVarName(nameNode) : undefined;
  if (!value || !varName || env.has(varName)) return;

  const ctorType = detectObjcConstructorType(value, classNames);
  if (ctorType) env.set(varName, ctorType);
};

const scanConstructorBinding: ConstructorBindingScanner = (node) => {
  if (node.type !== 'declaration') return undefined;

  const declarator = node.childForFieldName('declarator');
  if (!declarator || declarator.type !== 'init_declarator') return undefined;

  const value = declarator.childForFieldName('value');
  if (!value || value.type !== 'message_expression') return undefined;

  const nameNode = unwrapDeclarator(declarator.childForFieldName('declarator'));
  const varName = nameNode ? extractVarName(nameNode) : undefined;
  if (!varName) return undefined;

  const methods = getMessageMethods(value);
  const receiver = value.childForFieldName('receiver');
  if (receiver?.type === 'identifier' && methods.some((method) => method === 'new' || method.startsWith('alloc'))) {
    return { varName, calleeName: receiver.text };
  }

  if (receiver?.type === 'message_expression') {
    const innerReceiver = receiver.childForFieldName('receiver');
    const innerMethods = getMessageMethods(receiver);
    if (innerReceiver?.type === 'identifier'
      && innerMethods.some((method) => method === 'new' || method.startsWith('alloc'))
      && methods.some((method) => method.startsWith('init'))) {
      return { varName, calleeName: innerReceiver.text };
    }
  }

  return undefined;
};

const extractPendingAssignment: PendingAssignmentExtractor = (node, scopeEnv) => {
  if (node.type !== 'declaration') return undefined;

  const declarator = node.childForFieldName('declarator');
  if (!declarator || declarator.type !== 'init_declarator') return undefined;

  const nameNode = unwrapDeclarator(declarator.childForFieldName('declarator'));
  const lhs = nameNode ? extractVarName(nameNode) : undefined;
  if (!lhs || scopeEnv.has(lhs)) return undefined;

  const value = declarator.childForFieldName('value');
  if (!value) return undefined;

  if (value.type === 'identifier') {
    return { kind: 'copy', lhs, rhs: value.text };
  }

  if (value.type === 'field_expression') {
    const receiver = value.childForFieldName('argument');
    const field = value.childForFieldName('field');
    if (receiver?.type === 'identifier' && field?.type === 'field_identifier') {
      return { kind: 'fieldAccess', lhs, receiver: receiver.text, field: field.text };
    }
  }

  if (value.type === 'call_expression') {
    const fn = value.childForFieldName('function');
    if (fn?.type === 'identifier') {
      return { kind: 'callResult', lhs, callee: fn.text };
    }
  }

  if (value.type === 'message_expression') {
    const receiver = value.childForFieldName('receiver');
    const method = getMessageMethods(value)[0];
    if (receiver?.type === 'identifier' && method) {
      return { kind: 'methodCallResult', lhs, receiver: receiver.text, method };
    }
  }

  return undefined;
};

const detectConstructorType: ConstructorTypeDetector = (node, classNames) => {
  if (node.type !== 'declaration') return undefined;
  const declarator = node.childForFieldName('declarator');
  const initDecl = declarator?.type === 'init_declarator' ? declarator : undefined;
  return detectObjcConstructorType(initDecl?.childForFieldName('value') ?? null, classNames);
};

export const typeConfig: LanguageTypeConfig = {
  declarationNodeTypes: DECLARATION_NODE_TYPES,
  extractDeclaration,
  extractParameter,
  extractInitializer,
  scanConstructorBinding,
  extractPendingAssignment,
  detectConstructorType,
};
