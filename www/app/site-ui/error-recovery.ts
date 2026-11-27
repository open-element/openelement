import type { SiteLocale } from '../../site-config.ts';

export const recoveryGuides = {
  envelope: {
    en: {
      href: '/guide/error-handling#the-machine-readable-envelope',
      label: 'Build diagnostic envelope',
    },
    zh: { href: '/guide/error-handling#机器可读的诊断信封', label: '构建诊断信封' },
  },
  boundary: {
    en: {
      href: '/guide/error-handling#in-the-browser-the-onerror-intrinsic',
      label: 'Element error boundaries',
    },
    zh: { href: '/guide/error-handling#在浏览器里-onerror-intrinsic', label: '元素错误边界' },
  },
  compiler: {
    en: { href: '/guide/compiled-grammar#the-laws', label: 'Compiler grammar' },
    zh: { href: '/guide/compiled-grammar#法则一览', label: '编译器语法' },
  },
  setup: {
    en: {
      href: '/guide/compiled-grammar#setup-declares-state-one-return',
      label: 'Component setup',
    },
    zh: { href: '/guide/compiled-grammar#setup-声明状态-只有一个-return', label: '组件 setup' },
  },
  jsx: {
    en: { href: '/guide/compiled-grammar#jsx-composes-by-tag', label: 'JSX composition' },
    zh: { href: '/guide/compiled-grammar#jsx-按标签组合', label: 'JSX 组合' },
  },
  attributes: {
    en: {
      href: '/guide/compiled-grammar#attributes-are-literals-or-admitted-channels',
      label: 'Attribute bindings',
    },
    zh: { href: '/guide/compiled-grammar#属性是字面量或受承认的通道', label: 'HTML 特性绑定' },
  },
  blocks: {
    en: { href: '/guide/compiled-grammar#branches-are-jsx-or-null', label: 'Conditional JSX' },
    zh: { href: '/guide/compiled-grammar#分支是-jsx-或-null', label: '条件 JSX' },
  },
  handlers: {
    en: { href: '/guide/compiled-grammar#handlers-are-functions', label: 'Event handlers' },
    zh: { href: '/guide/compiled-grammar#处理器是函数', label: '事件处理器' },
  },
  html: {
    en: {
      href: '/guide/compiled-grammar#innerhtml-is-out-of-this-lane',
      label: 'HTML safety boundary',
    },
    zh: { href: '/guide/compiled-grammar#innerhtml-不在本范式内', label: 'HTML 安全边界' },
  },
  pages: {
    en: { href: '/guide/routing-and-data#server-function-pages', label: 'Server function pages' },
    zh: { href: '/guide/routing-and-data#服务端函数页', label: '服务端函数页' },
  },
  routes: {
    en: { href: '/guide/routing-and-data#file-routes', label: 'File routes' },
    zh: { href: '/guide/routing-and-data#文件路由', label: '文件路由' },
  },
  data: {
    en: { href: '/guide/routing-and-data#data-boundary', label: 'Loader data boundary' },
    zh: { href: '/guide/routing-and-data#数据边界', label: 'Loader 数据边界' },
  },
  hydration: {
    en: { href: '/guide/islands-and-ssr#hydration-boundary', label: 'Hydration boundary' },
    zh: { href: '/guide/islands-and-ssr#hydration-边界', label: 'Hydration 边界' },
  },
  islands: {
    en: { href: '/guide/islands-and-ssr#declared-islands', label: 'Island declarations' },
    zh: { href: '/guide/islands-and-ssr#声明的-islands', label: 'Island 声明' },
  },
  styles: {
    en: {
      href: '/guide/configuration#one-policy-two-stylesheet-channels',
      label: 'Stylesheet delivery',
    },
    zh: { href: '/guide/configuration#一条策略-两条样式表通道', label: '样式表交付' },
  },
  config: {
    en: { href: '/guide/configuration#openelement-config-ts', label: 'Project configuration' },
    zh: { href: '/guide/configuration#openelement-config-ts', label: '项目配置' },
  },
  head: {
    en: { href: '/guide/configuration#app-head-tsx', label: 'Document head entries' },
    zh: { href: '/guide/configuration#app-head-tsx', label: '文档 head 条目' },
  },
  build: {
    en: { href: '/guide/deployment#build-start-preview', label: 'Build and serve the output' },
    zh: { href: '/guide/deployment#build-start-preview', label: '构建并运行产物' },
  },
  mdx: {
    en: { href: '/guide/mdx#build-path', label: 'MDX build path' },
    zh: { href: '/guide/mdx#构建路径', label: 'MDX 构建路径' },
  },
} satisfies Record<string, Record<SiteLocale, { href: string; label: string }>>;

type Guide = keyof typeof recoveryGuides;
type Localized<T> = Record<SiteLocale, T>;
type Check = [meaning: string, nextStep: string];

interface Recovery {
  guide: Guide;
  en: Check;
  zh: Check;
}

// These explanations supplement the generated source messages with checks for the named construct.
export const compilerRecovery: Readonly<Record<string, Recovery>> = {
  OEC9000: {
    guide: 'envelope',
    en: [
      'TypeScript could not parse the source file.',
      'Open the file at the line and column in your build output. Use the accompanying TypeScript message to fix the syntax, then rebuild.',
    ],
    zh: [
      'TypeScript 无法解析此源文件。',
      '打开构建输出中所指的文件和行列，按随附的 TypeScript 消息修正语法，然后重新构建。',
    ],
  },
  OEC9007: {
    guide: 'setup',
    en: [
      'The component render needs a single JSX root.',
      'Check the returned expression. If there are sibling roots, wrap them in one element and return that element.',
    ],
    zh: [
      '组件的渲染结果需要一个 JSX 根元素。',
      '检查返回表达式。若并列返回了多个根节点，用一个元素包住它们，再返回该元素。',
    ],
  },
  OEC9010: {
    guide: 'jsx',
    en: [
      'A JSX tag is invalid or unsupported in this position.',
      'Check the tag named in the message. Use a supported HTML tag or the registered custom-element tag name. Server functions called by identifier follow the server-function composition rules.',
    ],
    zh: [
      '此处的 JSX 标签不合法或不受支持。',
      '检查消息中指明的标签，使用受支持的 HTML 标签或已注册的自定义元素标签名。按标识符调用服务端函数时，遵守服务端函数的组合规则。',
    ],
  },
  OEC9011: {
    guide: 'attributes',
    en: [
      'An attribute or binding does not meet the grammar for that element or scope.',
      'Check the named attribute or property and its allowed value. Pay attention to whether the message refers to a literal, declared prop, list item, or ref.',
    ],
    zh: [
      'HTML 特性或绑定不符合该元素或作用域的语法。',
      '检查消息指明的特性或属性及其允许的值，留意它说的是字面量、声明的 prop、列表项还是 ref。',
    ],
  },
  OEC9012: {
    guide: 'blocks',
    en: [
      'A conditional branch or nested Block cannot be compiled as written.',
      'Check the named branch for nesting and unsupported text, refs, or handlers. For a text-only choice, derive the text separately and bind it.',
    ],
    zh: [
      '条件分支或嵌套 Block 无法按当前写法编译。',
      '检查提示的分支中是否有嵌套、受限的文本、ref 或处理器。若条件只改变文本，先派生文本，再绑定。',
    ],
  },
  OEC9013: {
    guide: 'jsx',
    en: [
      'The compiler rejected a JSX child, expression, or list mapper.',
      'Use the full message to identify the rejected value. For a keyed list, check the mapper parameter and the single JSX item it returns. For a void tag, remove its children.',
    ],
    zh: [
      '编译器拒绝了某个 JSX 子节点、表达式或列表映射函数。',
      '根据完整消息定位被拒绝的值。若涉及带 key 的列表，检查映射函数的参数和它返回的单个 JSX 项；若涉及空元素，移除它的子节点。',
    ],
  },
  OEC9014: {
    guide: 'jsx',
    en: [
      'A keyed list item is missing a valid key binding.',
      'Give each item root one key tied to an item field, such as key={item.id}. Check that the field identifies the same item across updates.',
    ],
    zh: [
      '列表项缺少合法的 key 绑定。',
      '在每个列表项的根节点上绑定一次 key，例如 key={item.id}。确认该字段在更新前后都能标识同一个列表项。',
    ],
  },
  OEC9016: {
    guide: 'handlers',
    en: [
      'The compiler could not lower the event action.',
      'Check the action named in the message. Keep it to one supported operation or move the logic into the handler form admitted by the component.',
    ],
    zh: [
      '编译器无法转换该事件操作。',
      '检查消息指明的操作，将它简化为一个受支持的操作，或把逻辑移入该组件支持的处理器形式。',
    ],
  },
  OEC9017: {
    guide: 'jsx',
    en: [
      'The current compiler path refused a handler, ref, or children on a custom-element host.',
      'Match the fix to the item named in the message. For a handler or ref, check the element or lifecycle placement allowed by that component. For children, verify the host’s slots or props contract.',
    ],
    zh: [
      '当前编译路径拒绝了自定义元素宿主上的处理器、ref 或子节点。',
      '按消息定位被拒绝的项。若涉及处理器或 ref，检查组件允许的元素或生命周期位置；若涉及子节点，核对宿主的插槽或 props 契约。',
    ],
  },
  OEC9024: {
    guide: 'setup',
    en: [
      'A computed expression or an assignment to a computed result was refused.',
      'Follow the exact message. Read or update the declared source properties instead of the computed result. If a nested function is flagged, move it to a supported scope.',
    ],
    zh: [
      '计算表达式或对计算结果的赋值未通过校验。',
      '按消息检查，直接读取或更新声明的源属性。若报告指向嵌套函数，将它移至受支持的作用域。',
    ],
  },
  OEC9026: {
    guide: 'html',
    en: [
      'An innerHTML binding was refused by the compiler’s trusted HTML checks.',
      'Check the message for the required trusted value, capability declaration, or target shape. For ordinary content, render text or JSX.',
    ],
    zh: [
      'innerHTML 绑定未通过编译器的可信 HTML 检查。',
      '检查消息指明的可信值、能力声明或目标元素要求。普通内容可直接用文本或 JSX 渲染。',
    ],
  },
  OEC9031: {
    guide: 'pages',
    en: [
      'Server function markup includes a client-only handler or ref.',
      'Keep the server page responsible for HTML. Move the interaction or element access into a compiled island.',
    ],
    zh: [
      '服务端函数的标记中包含仅限客户端的处理器或 ref。',
      '让服务端页面负责 HTML，把交互或元素访问移入编译后的 island。',
    ],
  },
  OEC9032: {
    guide: 'pages',
    en: [
      'A server function component uses a signature, prop, composition, or await form this path cannot compile.',
      'Check the exact reported expression. Verify the inline props type, how the components compose, and whether a parent that awaits an async child is itself async.',
    ],
    zh: [
      '服务端函数组件的签名、prop、组合方式或 await 写法超出了当前编译规则。',
      '定位报告指明的表达式，核对内联 props 类型、组件组合方式，以及等待异步子组件的父组件是否也声明为 async。',
    ],
  },
  OEC9040: {
    guide: 'setup',
    en: [
      'The compiler could not recognize the function component’s shape.',
      'Check the component export, its props parameter, and that its body returns one JSX element.',
    ],
    zh: [
      '编译器无法识别该函数组件的结构。',
      '检查组件导出、props 参数，以及函数体是否返回一个 JSX 元素。',
    ],
  },
  OEC9041: {
    guide: 'setup',
    en: [
      'A statement in the function component body is outside the supported setup grammar.',
      'Locate the reported statement and compare it with the supported setup declarations and single JSX return.',
    ],
    zh: [
      '函数组件体内的语句不符合受支持的 setup 语法。',
      '定位报告中的语句，核对它是否符合支持的 setup 声明和单个 JSX 返回规则。',
    ],
  },
  OEC9042: {
    guide: 'compiler',
    en: [
      'A declaration, intrinsic call, or JSX form is unsupported in this position.',
      'Check the reported syntax. For a spread attribute, write the individual supported bindings; for an intrinsic, check the required arguments and placement.',
    ],
    zh: [
      '此处的声明、内置调用或 JSX 写法不受支持。',
      '检查报告指明的语法。展开特性可改为逐项绑定；若涉及内置调用，核对参数和调用位置。',
    ],
  },
  OEC9043: {
    guide: 'compiler',
    en: [
      'The compiler could not validate a read or expression.',
      'Use the additional code and text in the full message to identify the refused value. Check where that value is declared and where it is read.',
    ],
    zh: [
      '编译器无法验证某个读取或表达式。',
      '根据完整消息中的附加代码和文字定位被拒绝的值，检查它的声明位置和读取位置。',
    ],
  },
  OEC9044: {
    guide: 'html',
    en: [
      'The function-component compiler does not admit innerHTML output.',
      'Replace that binding with supported JSX or a text binding for ordinary content.',
    ],
    zh: ['函数组件编译器不支持 innerHTML 输出。', '普通内容请改用受支持的 JSX 或文本绑定。'],
  },
};

export const runtimeSpecific: Readonly<Record<string, Recovery>> = {
  BOUNDARY_CAUGHT: {
    guide: 'boundary',
    en: [
      'Legacy code for a render failure caught by an error boundary.',
      'Inspect the original error or stack. In the current generated element model, the element’s onError callback receives the original thrown value.',
    ],
    zh: [
      '早期用于标记渲染失败已被错误边界捕获的代码。',
      '查看原始错误或堆栈。在当前生成式元素中，该元素的 onError 回调会收到原始抛出值。',
    ],
  },
  SSR_RENDER_ERROR: {
    guide: 'styles',
    en: [
      'Server rendering could not produce valid element markup.',
      'Identify the component from the message and server stack. If the message names missing assets for IslandConfig.styles in dev, try a production build and verify those styles are emitted.',
    ],
    zh: [
      '服务端渲染未能生成有效的元素标记。',
      '根据消息和服务端堆栈定位组件。若提示开发模式缺少 IslandConfig.styles 对应的产物，请尝试生产构建并确认样式已经生成。',
    ],
  },
  UNKNOWN: {
    guide: 'envelope',
    en: [
      'The failure did not supply a more specific framework code.',
      'Keep the original message, cause, and stack. Use the reported phase and the command or request that triggered it to find the first failing call.',
    ],
    zh: [
      '这次失败没有提供更具体的框架错误码。',
      '保留原始消息、原因和堆栈。根据报告中的阶段以及触发它的命令或请求，定位最先失败的调用。',
    ],
  },
  OE_COMPILER_INVALID_SOURCE: {
    guide: 'envelope',
    en: [
      'The compiler could not analyze the source, or a generated element descriptor was rejected.',
      'Read the full build message. For a [generated-element] error, check the named property, attribute, or descriptor field. If it says typeCheckEmittedModule never emits, report the command and a minimal reproduction.',
    ],
    zh: [
      '编译器无法分析源文件，或生成的元素描述符未通过校验。',
      '查看完整构建消息。若以 [generated-element] 开头，检查指明的属性、HTML 特性或描述符字段。若消息为 typeCheckEmittedModule never emits，请提交运行命令和最小复现。',
    ],
  },
  OE_COMPILER_DIAGNOSTICS: {
    guide: 'envelope',
    en: [
      'One or more source-located diagnostics stopped compilation.',
      'Find the accompanying OEC code with a file, line, and column. Start with that specific diagnostic and rebuild after correcting it.',
    ],
    zh: [
      '一条或多条带源码位置的诊断中止了编译。',
      '找到同时给出文件、行和列的 OEC 错误码。先处理这条具体诊断，再重新构建。',
    ],
  },
  OE_ISLAND_DESCRIPTOR_SHAPE: {
    guide: 'islands',
    en: [
      'An island declaration has the wrong shape or an unsupported field.',
      'Open the named module and compare its defineIslandConfig object with the supported fields.',
    ],
    zh: [
      'Island 声明的结构不正确，或包含未受支持的字段。',
      '打开报告指明的模块，核对其 defineIslandConfig 对象中的受支持字段。',
    ],
  },
  OE_ISLAND_HYDRATE: {
    guide: 'islands',
    en: [
      'The hydrate strategy is unsupported or disagrees with media.',
      'Check the named island’s hydrate value. Use the media field only with the media strategy and supply the query there.',
    ],
    zh: [
      'Hydrate 策略不受支持，或与 media 声明不一致。',
      '检查对应 island 的 hydrate 值。仅在使用 media 策略时声明 media，并在其中提供查询条件。',
    ],
  },
  OE_EACH_KEY_DUPLICATE: {
    guide: 'jsx',
    en: [
      'Two items in one list produced the same key.',
      'Inspect the item data for repeated key values. Use a stable field that distinguishes each simultaneously rendered item.',
    ],
    zh: [
      '同一个列表里有两个项生成了相同的 key。',
      '检查列表数据中重复的 key 值，使用能区分同时渲染的各项且保持稳定的字段。',
    ],
  },
  OE_DOCUMENT_HEAD_INVALID: {
    guide: 'head',
    en: [
      'A document head field or structured-data value failed validation.',
      'Locate the field named in the message and check the value supplied by the page head or document head configuration.',
    ],
    zh: [
      '文档 head 字段或结构化数据值未通过校验。',
      '找出消息指明的字段，检查页面 head 或文档 head 配置提供的值。',
    ],
  },
};

type Stage = {
  guide: Guide;
  nextStep: Localized<string>;
};

const stages = {
  build: {
    guide: 'build',
    nextStep: {
      en: 'Check the paths and files named in the first failure. Reproduce with build and serve commands from the same checkout and inspect the output they actually emitted.',
      zh: '检查首条失败消息指明的路径和文件。在同一个源码检出中用构建和运行命令复现，并检查实际生成的产物。',
    },
  },
  browser: {
    guide: 'hydration',
    nextStep: {
      en: 'Identify the element and operation in the stack. Compare the server HTML and the module loaded by the browser; for mount, claim, or update failures, check where the two diverge.',
      zh: '根据堆栈定位元素和操作。对照服务端 HTML 和浏览器加载的模块；若安装、claim 或更新失败，检查两者从何处开始不一致。',
    },
  },
  compiler: {
    guide: 'envelope',
    nextStep: {
      en: 'Use the first source-located diagnostic and the exact failing operation. Check the reported field or value before changing build configuration.',
      zh: '先查看首条带源码位置的诊断及具体失败的操作。修改构建配置前，先核对报告指明的字段或值。',
    },
  },
  config: {
    guide: 'config',
    nextStep: {
      en: 'Open the configuration or module named in the error and compare the reported option and value with the contract for the command you ran.',
      zh: '打开错误中指明的配置或模块，按实际执行命令的约定核对报告指出的选项和值。',
    },
  },
  data: {
    guide: 'data',
    nextStep: {
      en: 'Identify the loader or request from the message. Check the returned fields and their shape against what the route render or stream expects.',
      zh: '根据消息定位 loader 或请求，核对返回的字段和结构是否符合路由渲染或流式响应的要求。',
    },
  },
  document: {
    guide: 'head',
    nextStep: {
      en: 'Check the named head field, tag, parameter, or data value where it enters the page renderer. Use the source declaration to identify the exact validated value.',
      zh: '在数据进入页面渲染器的位置，检查报告指明的 head 字段、标签、参数或数据值。源码声明能帮助确定实际受校验的值。',
    },
  },
  islands: {
    guide: 'islands',
    nextStep: {
      en: 'Find the named island, tag, or package. Check its declaration and import path, then verify what the build admits and emits for that entry.',
      zh: '定位报告指明的 island、标签或包。核对它的声明和导入路径，再检查构建实际准入并生成了哪些入口。',
    },
  },
  mdx: {
    guide: 'mdx',
    nextStep: {
      en: 'Check the reported route file or dependency against the supported MDX input and its build requirements.',
      zh: '按照支持的 MDX 输入和构建要求，核对报告指明的路由文件或依赖。',
    },
  },
  routing: {
    guide: 'routes',
    nextStep: {
      en: 'Use the named route, tag, or file to locate the source module. Verify its filename, component entry, and any route options named in the error.',
      zh: '按消息中指明的路由、标签或文件定位源码模块，检查文件名、组件入口和报错所涉及的路由选项。',
    },
  },
  server: {
    guide: 'pages',
    nextStep: {
      en: 'Use the full server message and stack to find the failing component or render input. Check that input against the server rendering contract.',
      zh: '根据完整服务端消息和堆栈定位出错的组件或渲染输入，再按服务端渲染契约核对该输入。',
    },
  },
  styles: {
    guide: 'styles',
    nextStep: {
      en: 'Check the named stylesheet, provider, or root. Trace that declaration to the style resource the build emits and the browser or server tries to use.',
      zh: '核对消息指明的样式表、提供方或根节点。顺着该声明检查构建生成、浏览器或服务端尝试使用的样式资源。',
    },
  },
} satisfies Record<string, Stage>;

export const runtimeStages: Readonly<Record<string, keyof typeof stages>> = {
  ErrorCode: 'compiler',
  ClaimErrorCode: 'browser',
  CompilerErrorCode: 'compiler',
  FacadeErrorCode: 'browser',
  ContextErrorCode: 'browser',
  EachKeyErrorCode: 'browser',
  AuthoringErrorCode: 'document',
  KernelErrorCode: 'browser',
  ProgramErrorCode: 'compiler',
  RuntimeErrorCode: 'browser',
  ServerErrorCode: 'server',
  StyleErrorCode: 'styles',
  AdapterErrorCode: 'config',
  ClientAssetErrorCode: 'build',
  BrowserEntryBoundaryErrorCode: 'islands',
  ClientBuildErrorCode: 'build',
  DeliveryErrorCode: 'islands',
  DescriptorErrorCode: 'config',
  DocumentErrorCode: 'document',
  IslandErrorCode: 'islands',
  IslandEntryErrorCode: 'islands',
  MdxErrorCode: 'mdx',
  PackageAdmissionErrorCode: 'islands',
  PackageIslandErrorCode: 'islands',
  PageErrorCode: 'routing',
  PresetErrorCode: 'styles',
  RendererErrorCode: 'server',
  RouteScanErrorCode: 'routing',
  ScanSurfaceErrorCode: 'islands',
  ServeErrorCode: 'build',
  SsgRenderErrorCode: 'build',
  SsgHygieneErrorCode: 'build',
  SsgDynamicErrorCode: 'routing',
  StreamErrorCode: 'data',
  WorkspaceAnchorErrorCode: 'build',
};

export function recoveryFor(code: string, family: string, locale: SiteLocale) {
  const specific = family === 'compiler' ? compilerRecovery[code] : runtimeSpecific[code];
  const stage = stages[runtimeStages[family] ?? 'compiler'];
  const [meaning, nextStep] = specific?.[locale] ?? ['', stage.nextStep[locale]];
  return { meaning, nextStep, guide: recoveryGuides[specific?.guide ?? stage.guide][locale] };
}
