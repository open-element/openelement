/**
 * Compiled error-code reference page (#1414, co-built with the W3 error
 * experience).
 *
 * The route projects the generated error-code inventory onto these plain
 * properties; this module contains only the compiler-owned element class and
 * its static render grammar. Code rows are a keyed list Region so server
 * output, browser creation and existing-DOM claim share one identity model.
 */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../site-ui/open-section-frame.tsx';
import '../islands/open-page-rail.tsx';
import { pageErrorsStyles } from './page-errors-styles.ts';

/** One diagnostic code row, projected from the generated inventory. */
export interface ErrorCodeItem {
  key: string;
  code: string;
  family: string;
  gloss: string;
  /** Every distinct normalized message the code raises, joined for display. */
  variants: string;
  /** `path:line` of every source call site, joined for display. */
  sites: string;
  runtime: string;
}

interface ErrorsRailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

interface ErrorsMetadata {
  breadcrumb: string;
  title: string;
  lede: string;
}

// The route->program tag binding reads this module's own @element tag
// (route-scanner semantics.exportedTagName); the path-derived tag is only
// the fallback for classes without one.
@element('errors-page')
export default class ErrorsPage extends OpenElement {
  static override styles = pageErrorsStyles;

  @property({ reflect: false, attribute: false })
  metadata: ErrorsMetadata = { breadcrumb: '', title: '', lede: '' };

  @property({ reflect: false, attribute: false })
  railItems: ErrorsRailItem[] = [];

  @property({ reflect: false, attribute: false })
  s1Index = '';

  @property({ reflect: false, attribute: false })
  s1Title = '';

  @property({ reflect: false, attribute: false })
  s1Copy = '';

  @property({ reflect: false, attribute: false })
  headCode = '';

  @property({ reflect: false, attribute: false })
  headGloss = '';

  @property({ reflect: false, attribute: false })
  headSites = '';

  @property({ reflect: false, attribute: false })
  codes: ErrorCodeItem[] = [];

  @property({ reflect: false, attribute: false })
  footnote = '';

  @property({ reflect: false, attribute: false })
  footnoteCheckPre = '';

  @property({ reflect: false, attribute: false })
  footnoteCheckPost = '';

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  render() {
    return (
      // Without data-pagefind-body the page is absent from the index entirely:
      // pagefind stops indexing every page that lacks the attribute. The shell
      // already renders the one <main> landmark (#main-content).
      <div data-pagefind-body>
        <open-reading-shell rail footer metadata={this.metadata} locale={this.locale}>
          <div slot='rail'>
            <open-page-rail items={this.railItems} locale={this.locale}></open-page-rail>
          </div>
          <open-section-frame>
            <span slot='index'>{this.s1Index}</span>
            <span slot='title'>{this.s1Title}</span>
            <span slot='copy'>{this.s1Copy}</span>
            <div class='codes' id='error-codes'>
              <div class='codes-head' aria-hidden='true'>
                <span>{this.headCode}</span>
                <span>{this.headGloss}</span>
                <span>{this.headSites}</span>
              </div>
              {this.codes.map((code) => (
                <div
                  class='code-row'
                  id={code.code}
                  data-runtime={code.runtime}
                  key={code.key}
                >
                  <div>
                    <span class='code-id'>{code.code}</span>
                    <span class='code-family'>{code.family}</span>
                  </div>
                  <div>
                    <p class='code-gloss'>{code.gloss}</p>
                    <p class='code-variants'>{code.variants}</p>
                  </div>
                  <span class='code-sites'>{code.sites}</span>
                </div>
              ))}
              <footer class='footnote'>
                <p>{this.footnote}</p>
                <p>
                  {this.footnoteCheckPre}
                  <code>deno task --cwd www check:error-codes</code>
                  {this.footnoteCheckPost}
                </p>
              </footer>
            </div>
          </open-section-frame>
        </open-reading-shell>
      </div>
    );
  }
}
