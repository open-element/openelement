import { createHash } from 'node:crypto';

/** Recover the previous direct adapter and its original named recipe. */
export function recipeBackedDirectElementOutput(code: string): string {
  return code
    .replace(
      'createDirectShadowElementClassWithProjection as __oe_createElementClass',
      'createDirectShadowElementClass as __oe_createElementClass',
    )
    .replace(
      /^ {2}source: [^\n]+\n {2}mount: (\w+)__mount,\n {2}claim: \1__claim,\n/m,
      '  createRecipe: create$1Recipe,\n',
    );
}

/** Recover the released one-argument factory wire for historical artifact pins. */
export function legacyGeneratedElementOutput(code: string): string {
  const recipeBackedCode = recipeBackedDirectElementOutput(code);
  const genericDescriptor = recipeBackedCode.includes(
    'createDirectShadowElementClass as __oe_createElementClass',
  )
    ? recipeBackedCode
        .replace(
          'createDirectShadowElementClass as __oe_createElementClass',
          'createGeneratedElementClass',
        )
        .replace(
          /^(const __oeElementDescriptor = \{\n {2}tag: [^\n]+\n)( {2}delegatesFocus: true,\n)?/m,
          '$1  root: "shadow-open",\n$2  properties: [],\n',
        )
        .replace(
          '__oe_createElementClass(__oeElementDescriptor);',
          'createGeneratedElementClass(__oeElementDescriptor);',
        )
    : recipeBackedCode;
  return genericDescriptor
    .replace(
      /^import \{ createGeneratedElementClassWithFeatures as __oe_createElementClass(?:, GeneratedElementForm as __oe_formFeature)?(?:, createGeneratedElementContext as __oe_contextFeature)?(?:, generatedElementLedger as __oe_ledgerFeature)?(?:, generatedElementProperties as __oe_propertiesFeature)?(?=[, ])/m,
      'import { createGeneratedElementClass',
    )
    .replace(
      /__oe_createElementClass\(__oeElementDescriptor, \{(?: (?:form: __oe_formFeature|context: __oe_contextFeature|ledger: __oe_ledgerFeature|properties: __oe_propertiesFeature)(?:, (?:form: __oe_formFeature|context: __oe_contextFeature|ledger: __oe_ledgerFeature|properties: __oe_propertiesFeature))* )?\}\);/,
      'createGeneratedElementClass(__oeElementDescriptor);',
    )
    .replace(
      'seedGeneratedElementHostPropertiesWithoutRows as seedGeneratedElementHostProperties',
      'seedGeneratedElementHostProperties',
    )
    .replace(
      'seedGeneratedElementHostProperties(props, attributes)',
      'seedGeneratedElementHostProperties(__oeElementDescriptor.properties, props, attributes)',
    );
}

export function hashBeforeFormFactorySplit(code: string): string {
  return createHash('sha256').update(legacyGeneratedElementOutput(code)).digest('hex');
}
