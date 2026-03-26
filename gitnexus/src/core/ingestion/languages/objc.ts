import { SupportedLanguages } from '../../../config/supported-languages.js';
import { defineLanguage } from '../language-provider.js';
import { typeConfig as objcConfig } from '../type-extractors/objc.js';
import { cCppExportChecker } from '../export-detection.js';
import { resolveObjcImport } from '../import-resolvers/standard.js';
import { OBJECTIVEC_QUERIES } from '../tree-sitter-queries.js';

export const objcProvider = defineLanguage({
  id: SupportedLanguages.ObjectiveC,
  extensions: ['.m', '.mm'],
  treeSitterQueries: OBJECTIVEC_QUERIES,
  typeConfig: objcConfig,
  exportChecker: cCppExportChecker,
  importResolver: resolveObjcImport,
  importSemantics: 'wildcard',
});
