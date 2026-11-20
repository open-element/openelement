import { computed, element, OpenElement, property, trustedHtml } from '@openelement/element';
import '../islands/open-page-rail.tsx';
import './open-reading-shell.tsx';
import '#site-ui/open-artifact-panel.tsx';
import type { ArticlePageModel } from './article-page-model.ts';

/** Compiled computed fields expose their derived value through the class facade. */
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

/** One row of the article shell's not-found fallback (no rows on a valid page). */
interface NotFoundFallbackRow {
  key: string;
  label: string;
}

@element('open-article-view')
export default class OpenArticleView extends OpenElement {
  @property({ reflect: false, attribute: false })
  model: ArticlePageModel = {
    notFoundClass: 'container',
    articleClass: 'is-hidden',
    slug: '',
    notFoundMessage: '',
    metadata: { breadcrumb: '', title: '', lede: '' },
    navigation: {},
    railItems: [],
    articleHtml: '',
  };
  // Visibility is the native `hidden` attribute: the retired sheet's
  // `.is-hidden` rule is gone, and the generated route bindings (the model
  // shape lives in article-page-model.ts + generate-site-article-routes.ts,
  // outside this batch) still carry the state as class-string tokens, so the
  // component reads the token it encoded and re-delivers it as `hidden`.
  @property({ reflect: false, attribute: false })
  articleHidden = computed(() => this.model.articleClass.includes('is-hidden'));
  @property({ reflect: false, attribute: false })
  metadata = computed(() => this.model.metadata);
  @property({ reflect: false, attribute: false })
  navigation = computed(() => this.model.navigation);
  @property({ reflect: false, attribute: false })
  railItems = computed(() => this.model.railItems);
  @property({ type: Object, reflect: false, attribute: false })
  articleHtml = computed(() => trustedHtml(this.model.articleHtml));
  /**
   * The not-found fallback is a zero-or-one list rather than a `when` branch on
   * purpose: a branch element cannot interpolate text (OEC9012) and the
   * fallback line is exactly this state's dynamic text, while an empty list
   * emits no markup at all. That is the root fix for WEB-002: the guarded
   * `hidden` copy this replaces still shipped "404: <slug>" in every valid
   * article page's textContent (the channel raw text extraction and reader
   * modes read), and a valid page now renders no fallback element at all. A
   * genuinely missing article projection renders the visible block below with
   * the model's message and slug.
   */
  @property({ reflect: false, attribute: false, type: Array })
  notFoundRows = computed(() =>
    this.model.notFoundClass.includes('is-hidden')
      ? []
      : [{ key: 'not-found', label: `${this.model.notFoundMessage}: ${this.model.slug}` }],
  ) as CompiledComputed<NotFoundFallbackRow[]>;

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  render() {
    // The article is the normal path and stays first in the template: a
    // path-addressed fixed sink (its `hidden`) must precede any dynamic Block
    // sibling (OEC9015). The 0/1 fallback list after it stays empty on a valid
    // page, so no fallback element — and no "404" text — is emitted. In the
    // not-found state the article is `hidden` and takes no layout box, so the
    // visible fallback still reads first on screen.
    return (
      <div>
        <div hidden={this.articleHidden} data-pagefind-body>
          <open-reading-shell
            rail
            footer
            metadata={this.metadata}
            navigation={this.navigation}
            locale={this.locale}
          >
            <div slot='rail'>
              <open-page-rail items={this.railItems} locale={this.locale}></open-page-rail>
            </div>
            <div class='article-content' innerHTML={this.articleHtml} trustedHtml />
          </open-reading-shell>
        </div>
        {this.notFoundRows.map((row) => (
          <div
            key={row.key}
            class='relative mx-auto max-w-(--site-container-reading) px-4 pt-6 pb-10 wrap-break-word [word-break:normal] [background:linear-gradient(90deg,transparent,color-mix(in_srgb,var(--color-border)_20%,transparent),transparent)_top/100%_1px_no-repeat] min-[481px]:px-5 min-[481px]:pt-8 min-[481px]:pb-12 min-[901px]:px-6 min-[901px]:pt-[clamp(2rem,5vh,3.5rem)] min-[901px]:pb-[clamp(6rem,14vh,11rem)]'
            data-pagefind-ignore
          >
            <p class='my-2 font-mono text-(length:--text-6xl) leading-[1.72] text-muted-foreground'>
              404
            </p>
            <p class='my-2 text-sm leading-[1.72] text-foreground min-[901px]:text-(length:--text-base)'>
              {row.label}
            </p>
          </div>
        ))}
      </div>
    );
  }
}
