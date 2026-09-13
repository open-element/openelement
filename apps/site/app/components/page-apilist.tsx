/**
 * Compiled API reference page (v0.44, ADR-0143/ADR-0148).
 *
 * The route projects locale and package records onto these plain properties;
 * this module contains only the compiler-owned element class and its static
 * render grammar. Package rows are a keyed list Region so server output,
 * browser creation and existing-DOM claim share one identity model.
 */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../site-ui/open-section-frame.tsx';
import '../islands/open-page-rail.tsx';
import { pageApiListStyles } from './page-apilist-styles.ts';

export interface ApiPackageItem {
  id: string;
  name: string;
  importPath: string;
  copy: string;
  note1: string;
  note2: string;
  note3: string;
  export1: string;
  export2: string;
  export3: string;
  export4: string;
  export5: string;
  kind: string;
  kindClass: string;
  kindLabel: string;
}

/** One generated export entry; `anchor` is the generated searchRecord anchor. */
export interface ApiReferenceItem {
  key: string;
  anchor: string;
  name: string;
  container: string;
  kind: string;
  stability: string;
  summary: string;
  source: string;
}

/** One generated custom-element record with its detail lists inlined. */
export interface ApiElementItem {
  key: string;
  anchor: string;
  tag: string;
  className: string;
  description: string;
  layer: string;
  hydrate: string;
  module: string;
  attributes: string;
  events: string;
  slots: string;
  cssParts: string;
  attributesLabel: string;
  eventsLabel: string;
  slotsLabel: string;
  partsLabel: string;
}

interface ApiRailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

interface ApiMetadata {
  breadcrumb: string;
  title: string;
  lede: string;
}

// definePage routes are registered by path-derived tag (apilist.tsx ->
// `apilist-page`); keeping the compiled program tag aligned lets renderDsd
// fail closed only for genuine mismatches.
@element('apilist-page')
export default class ApiCorePage extends OpenElement {
  static override styles = pageApiListStyles;

  @property({ reflect: false, attribute: false })
  metadata: ApiMetadata = { breadcrumb: '', title: '', lede: '' };

  @property({ reflect: false, attribute: false })
  railItems: ApiRailItem[] = [];

  @property({ reflect: false, attribute: false })
  s1Index = '';

  @property({ reflect: false, attribute: false })
  s1Title = '';

  @property({ reflect: false, attribute: false })
  s1Copy = '';

  @property({ reflect: false, attribute: false })
  s2Index = '';

  @property({ reflect: false, attribute: false })
  s2Title = '';

  @property({ reflect: false, attribute: false })
  s2Copy = '';

  @property({ reflect: false, attribute: false })
  headPackage = '';

  @property({ reflect: false, attribute: false })
  headSubpaths = '';

  @property({ reflect: false, attribute: false })
  headKind = '';

  @property({ reflect: false, attribute: false })
  footnote = '';

  @property({ reflect: false, attribute: false })
  footnoteCheckPre = '';

  @property({ reflect: false, attribute: false })
  footnoteCheckPost = '';

  @property({ reflect: false, attribute: false })
  packages: ApiPackageItem[] = [];

  @property({ reflect: false, attribute: false })
  s3Index = '';

  @property({ reflect: false, attribute: false })
  s3Title = '';

  @property({ reflect: false, attribute: false })
  s3Copy = '';

  @property({ reflect: false, attribute: false })
  headExport = '';

  @property({ reflect: false, attribute: false })
  headSummary = '';

  @property({ reflect: false, attribute: false })
  headSource = '';

  @property({ reflect: false, attribute: false })
  referenceEntries: ApiReferenceItem[] = [];

  @property({ reflect: false, attribute: false })
  s4Index = '';

  @property({ reflect: false, attribute: false })
  s4Title = '';

  @property({ reflect: false, attribute: false })
  s4Copy = '';

  @property({ reflect: false, attribute: false })
  elementEntries: ApiElementItem[] = [];

  render() {
    return (
      <main>
        <open-reading-shell
          rail
          footer
          metadata={this.metadata}
        >
          <div slot='rail'>
            <open-page-rail items={this.railItems}></open-page-rail>
          </div>
          <open-section-frame>
            <span slot='index'>{this.s1Index}</span>
            <span slot='title'>{this.s1Title}</span>
            <span slot='copy'>{this.s1Copy}</span>
          </open-section-frame>
          <open-section-frame>
            <span slot='index'>{this.s2Index}</span>
            <span slot='title'>{this.s2Title}</span>
            <span slot='copy'>{this.s2Copy}</span>
            <div class='registry'>
              <div class='registry-head' aria-hidden='true'>
                <span>{this.headPackage}</span>
                <span>{this.headSubpaths}</span>
                <span>{this.headKind}</span>
              </div>
              {this.packages.map((pkg) => (
                <div class='pkg-row' id={pkg.id} data-kind={pkg.kind} key={pkg.id}>
                  <div>
                    <span class='pkg-name'>{pkg.name}</span>
                    <span class='pkg-path'>{pkg.importPath}</span>
                    <p class='pkg-copy'>{pkg.copy}</p>
                    <span class='pkg-note'>{pkg.note1}</span>
                    <span class='pkg-note'>{pkg.note2}</span>
                    <span class='pkg-note'>{pkg.note3}</span>
                  </div>
                  <div class='pkg-chips'>
                    <span class='chip'>{pkg.export1}</span>
                    <span class='chip'>{pkg.export2}</span>
                    <span class='chip'>{pkg.export3}</span>
                    <span class='chip'>{pkg.export4}</span>
                    <span class='chip'>{pkg.export5}</span>
                  </div>
                  <span class={pkg.kindClass}>{pkg.kindLabel}</span>
                </div>
              ))}
              <footer class='footnote'>
                <p>{this.footnote}</p>
                <p>
                  {this.footnoteCheckPre}
                  <code>deno task package-surface:check</code>
                  {this.footnoteCheckPost}
                </p>
              </footer>
            </div>
          </open-section-frame>
          <open-section-frame>
            <span slot='index'>{this.s3Index}</span>
            <span slot='title'>{this.s3Title}</span>
            <span slot='copy'>{this.s3Copy}</span>
            <div class='registry' id='api-reference'>
              <div class='registry-head' aria-hidden='true'>
                <span>{this.headExport}</span>
                <span>{this.headSummary}</span>
                <span>{this.headSource}</span>
              </div>
              {this.referenceEntries.map((entry) => (
                <div class='ref-row' id={entry.anchor} key={entry.key}>
                  <div>
                    <span class='ref-name'>{entry.name}</span>
                    <span class='ref-container'>{entry.container}</span>
                    <span class='chip'>{entry.kind}</span>
                    <span class='chip chip-stability'>{entry.stability}</span>
                  </div>
                  <p class='ref-summary'>{entry.summary}</p>
                  <span class='ref-source'>{entry.source}</span>
                </div>
              ))}
            </div>
          </open-section-frame>
          <open-section-frame>
            <span slot='index'>{this.s4Index}</span>
            <span slot='title'>{this.s4Title}</span>
            <span slot='copy'>{this.s4Copy}</span>
            <div class='registry' id='element-reference'>
              {this.elementEntries.map((element) => (
                <div class='ce-row' id={element.anchor} key={element.key}>
                  <div>
                    <span class='ce-tag'>{element.tag}</span>
                    <span class='ce-class'>{element.className}</span>
                    <span class='chip'>{element.layer}</span>
                    <span class='chip'>{element.hydrate}</span>
                  </div>
                  <p class='ce-description'>{element.description}</p>
                  <span class='ce-module'>{element.module}</span>
                  <div class='ce-details'>
                    <span class='ce-detail'>
                      <b>{element.attributesLabel}</b>
                      {element.attributes}
                    </span>
                    <span class='ce-detail'>
                      <b>{element.eventsLabel}</b>
                      {element.events}
                    </span>
                    <span class='ce-detail'>
                      <b>{element.slotsLabel}</b>
                      {element.slots}
                    </span>
                    <span class='ce-detail'>
                      <b>{element.partsLabel}</b>
                      {element.cssParts}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </open-section-frame>
        </open-reading-shell>
      </main>
    );
  }
}
