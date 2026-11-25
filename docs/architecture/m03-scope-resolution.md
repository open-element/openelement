---
status: active
topic: Compiler lexical binding model
summary: Binding identity, JavaScript scope and snapshot semantics, and the host's import classification contract.
---

# Compiler lexical binding model

The semantic frontend resolves authored identifiers before lowering
expressions. A `BindingId` identifies the module, scope, name and declaration
position within one compilation. Declaration records carry the authored span
and declaration kind. Classification such as signal, computed value, prop or
ordinary local is a separate fact. A compiler host can refine classification
without changing the binding's identity. [Resolver implementation](../../packages/compiler/src/internal/compiler/semantic-core/scope-resolution.ts)

## 3. Binding identity and declarations

### Declaration merging and redeclaration

| Situation | Resolution |
| --- | --- |
| `var x` twice in one function scope | one binding, `declarationOrder` 0; second declaration is the same identity |
| `function f` twice (overloads) | one binding; signatures merge, implementations must be one |
| `var` + `function` same name in one scope | one binding; two `DeclarationRecord`s |
| `parameter` + `var` same name | one binding; parameter and var records both retained |
| `let`/`const` + `var` same name in one scope | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| `function` + `const`/`let` same name | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| `class` + `var` same name | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| two `function` declarations (overloads) | one binding, multiple `DeclarationRecord`s |
| `let`/`const` shadowing an outer name | new binding in the inner scope; outer untouched |
| duplicate `let`/`const` in the same scope | **diagnostic** `OEIR_DUPLICATE_DECLARATION` |
| `import x` + local `const x` in module scope | **diagnostic** `OEIR_IMPORT_CONFLICT` |
| parameter + `var` of the same name in the body | one binding (function-scoped var merges into the parameter scope) |
| class **declaration** | two bindings: an outer `class` binding in the enclosing scope, plus an inner `class-name` binding visible only inside the class body — so `static create() { return new Counter(); }` resolves to the inner one, and `new Counter()` outside resolves to the outer one |
| named **class expression** `const Factory = class Internal {}` | `Internal` is a `class-name` binding visible **only** inside the class body; `Factory` is an ordinary `const` |
| anonymous class expression `const F = class {}` | only the outer `const` binding |
| class field initializers / static blocks | may reference the inner `class-name` binding; not the outer one if not yet initialized |
| `extends` clause | evaluated in the **enclosing** scope (the inner name is not in scope for the heritage expression) |
| namespace / enum merging | **unsupported**, fail closed |

## 4. JavaScript scope and values

Preserve lexical shadowing, function-scoped `var` hoisting, block scopes,
parameter default visibility, per-iteration `let` scope, and class-name
visibility. The temporal dead zone follows runtime evaluation order. A closure
can capture a binding before initialization and run after initialization.

The original props object parameter carries the prop origin. A destructured
prop is an ordinary local snapshot, including nested patterns, defaults and
rest. A JSX binding subscribes when its expression reads the original prop
directly. The same distinction applies to early snapshots of signal values.
[Authoring contract](./tsx-author-candidate-contract.md)

## 5. Reads, captures and dependency edges

A read identifies a resolved binding. A capture crosses a function boundary.
A dependency is a reactive edge chosen for an expression's evaluation mode.
A handler can close over a signal and read its latest value when invoked,
while a tracked JSX binding or a computed expression subscribes to the value
it reads. Setup snapshots do not create reactive dependencies.

## 6. Host import classification

Cross-module classification comes from the host. The classifier identifies
the imported symbol's role, a namespace member, and the resulting kind of a
factory call separately. Resolve aliases to the original import name. Treat a
missing classification as unknown. A context that requires classification
fails with a located diagnostic.

### 6.1 How classifier results flow into the resolver

The three questions are chained, in this order; nothing is inferred from a name:

```ts
import * as Runtime from 'runtime';
const count = Runtime.signal(0);
```

| Step | Question | Answer source |
| --- | --- | --- |
| 1 | what is `Runtime`? | `classifySymbol('runtime', null)` → `namespace` |
| 2 | what is `Runtime.signal`? | `classifyMember('runtime', 'signal')` → `factory` |
| 3 | what does calling it produce? | `classifyCall('runtime', 'signal')` → `{ call: 'signal' }` |
| 4 | what is `count`? | the **call result** fixes `count.valueKind = 'signal'` |

For a direct import the same chain starts at `classifySymbol`:

| Step | Question | Answer source |
| --- | --- | --- |
| 1 | what is the imported `signal`? | `classifySymbol('x', 'signal')` → `factory` |
| 2 | what does calling it produce? | `classifyCall('x', 'signal')` → `{ call: 'signal' }` |
| 3 | what is `const count = signal(0)`? | `count.valueKind = 'signal'` |

Failure behaviour:

- if `classifyMember` is not implemented by the host, `Runtime.signal` is
  `unknown`; the call result is `unknown`; `count.valueKind` is `unknown`;
- `unknown` is only fatal where a kind is **required** (a tracked slot), and there
  the diagnostic says which specifier/member was unclassified;
- the resolver never guesses a factory from the name `signal` itself.

No full `ts.Program` is required for this: the classifier is a lookup the host
provides, through compiler input metadata. A checker may be consulted for
advisory diagnostics; its symbols never enter the IR.

[Resolver cases](../../packages/compiler/__tests__/semantic-ir/scope-resolution.test.ts) · [Historical design record](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/architecture/m03-scope-resolution.md)
