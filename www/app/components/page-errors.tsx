/**
 * Compiled error-code reference page (#1413 W3, ADR-0143/ADR-0148).
 *
 * The route projects the generated catalog (www/app/data/_generated-error-reference.ts)
 * onto these plain properties; this module owns only the compiled element and
 * its markup. Code rows are a keyed list Region so server output, browser
 * creation and existing-DOM claim share one identity model — the same shape
 * the API reference uses for its export rows.
 *
 * No code list is authored here. Every row comes from the generator, which
 * reads the codes out of the compiler's own diagnostic literals; the CI gate
 * fails if a code exists in source without appearing in the catalog.
 */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../site-ui/open-section-frame.tsx';
import '../islands/open-page-rail.tsx';
import { pageErrorsStyles } from './page-errors-styles.ts';

/** One generated error-code record, flattened for the keyed list Region. */
export interface ErrorCodeItem {
  key: string;
  anchor: string;
  code: string;
  family: string;
  familyClass: string;
  phase: string;
  severity: string;
  severityClass: string;
  message: string;
  source: string;
  occurrences: string;
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

/** One authored footnote line; the keyed Region needs an object with a field. */
interface ErrorsNote {
  key: string;
  value: string;
}

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
  headFamily = '';

  @property({ reflect: false, attribute: false })
  headPhase = '';

  @property({ reflect: false, attribute: false })
  headSeverity = '';

  @property({ reflect: false, attribute: false })
  headMessage = '';

  @property({ reflect: false, attribute: false })
  headSource = '';

  @property({ reflect: false, attribute: false })
  headSites = '';

  @property({ reflect: false, attribute: false })
  codeCount = '';

  @property({ reflect: false, attribute: false })
  s2Index = '';

  @property({ reflect: false, attribute: false })
  s2Title = '';

  @property({ reflect: false, attribute: false })
  s2Copy = '';

  @property({ reflect: false, attribute: false })
  footnote: ErrorsNote[] = [];

  @property({ reflect: false, attribute: false })
  codes: ErrorCodeItem[] = [];

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  render() {
    return (
      <div data-pagefind-body>
        <open-reading-shell
          rail
          footer
          metadata={this.metadata}
          locale={this.locale}
        >
          <div slot='rail'>
            <open-page-rail items={this.railItems} locale={this.locale}></open-page-rail>
          </div>
          <open-section-frame>
            <span slot='index'>{this.s1Index}</span>
            <span slot='title'>{this.s1Title}</span>
            <span slot='copy'>{this.s1Copy}</span>
            <div class='registry' id='error-table'>
              <span class='count'>{this.codeCount}</span>
              <div class='registry-head' aria-hidden='true'>
                <span>{this.headCode}</span>
                <span>{this.headFamily}</span>
                <span>{this.headPhase}</span>
                <span>{this.headSeverity}</span>
              </div>
              {this.codes.map((item) => (
                <div class='code-row' id={item.anchor} data-severity={item.severity} key={item.key}>
                  <div class='code-line'>
                    <code class='code-id'>{item.code}</code>
                    <span class={item.severityClass}>{item.severity}</span>
                  </div>
                  <span class={item.familyClass}>{item.family}</span>
                  <span class='phase'>{item.phase}</span>
                  <div class='detail'>
                    <p class='message'>{item.message}</p>
                    <span class='source'>{item.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </open-section-frame>
          <open-section-frame>
            <span slot='index'>{this.s2Index}</span>
            <span slot='title'>{this.s2Title}</span>
            <span slot='copy'>{this.s2Copy}</span>
            <ul class='notes' id='how-to-read'>
              {this.footnote.map((note) => <li key={note.key}>{note.value}</li>)}
            </ul>
          </open-section-frame>
        </open-reading-shell>
      </div>
    );
  }
}
