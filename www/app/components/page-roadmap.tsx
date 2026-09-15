/**
 * Compiled roadmap page (v0.44, ADR-0143/ADR-0148).
 *
 * The route projects locale, version data, and list records onto declared
 * properties; this module owns only the compiled element and its markup.
 */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-badge';
import '@openelement/ui/open-button';
import '../site-ui/open-standards-visual.tsx';
import '@openelement/site-ui/open-artifact-panel.tsx';
import '@openelement/site-ui/open-section-frame.tsx';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import { pageRoadmapStyles } from './page-roadmap-styles.ts';

interface RoadmapTimelineItem {
  key: string;
  rowClass: string;
  version: string;
  theme: string;
  stampClass: string;
  stampLabel: string;
  copy: string;
  status: string;
}

interface RoadmapListItem {
  key: string;
  value: string;
}

interface RoadmapMetadata {
  breadcrumb: string;
  title: string;
  lede: string;
}

interface RoadmapRailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('roadmap-page')
export default class RoadmapPage extends OpenElement {
  static override styles = pageRoadmapStyles;

  @property({ reflect: false, attribute: false })
  metadata: RoadmapMetadata = { breadcrumb: '', title: '', lede: '' };
  @property({ reflect: false, attribute: false })
  railItems: RoadmapRailItem[] = [];
  @property({ reflect: false, attribute: false })
  releaseLineIndex = '';
  @property({ reflect: false, attribute: false })
  releaseLineTitle = '';
  @property({ reflect: false, attribute: false })
  releaseLineCopy = '';
  @property({ reflect: false, attribute: false })
  freezeBadge = '';
  @property({ reflect: false, attribute: false })
  nowTitle = '';
  @property({ reflect: false, attribute: false })
  nowCopy = '';
  @property({ reflect: false, attribute: false })
  timelineAria = '';
  @property({ reflect: false, attribute: false })
  timeline: RoadmapTimelineItem[] = [];
  @property({ reflect: false, attribute: false })
  designRuleTitle = '';
  @property({ reflect: false, attribute: false })
  designRuleText = '';
  @property({ reflect: false, attribute: false })
  boundaryIndex = '';
  @property({ reflect: false, attribute: false })
  boundaryTitle = '';
  @property({ reflect: false, attribute: false })
  boundaryCopy = '';
  @property({ reflect: false, attribute: false })
  inProductLabel = '';
  @property({ reflect: false, attribute: false })
  inProductTitle = '';
  @property({ reflect: false, attribute: false })
  inProductItems: RoadmapListItem[] = [];
  @property({ reflect: false, attribute: false })
  outScopeLabel = '';
  @property({ reflect: false, attribute: false })
  outScopeTitle = '';
  @property({ reflect: false, attribute: false })
  outScopeItems: RoadmapListItem[] = [];
  @property({ reflect: false, attribute: false })
  siteRuleLabel = '';
  @property({ reflect: false, attribute: false })
  siteRuleTitle = '';
  @property({ reflect: false, attribute: false })
  siteRuleText = '';
  @property({ reflect: false, attribute: false })
  matrixIndex = '';
  @property({ reflect: false, attribute: false })
  matrixTitle = '';
  @property({ reflect: false, attribute: false })
  matrixCopy = '';
  @property({ reflect: false, attribute: false })
  shipLabel = '';
  @property({ reflect: false, attribute: false })
  shipCopy = '';
  @property({ reflect: false, attribute: false })
  proveLabel = '';
  @property({ reflect: false, attribute: false })
  proveCopy = '';
  @property({ reflect: false, attribute: false })
  freezeLabel = '';
  @property({ reflect: false, attribute: false })
  freezeCopy = '';
  @property({ reflect: false, attribute: false })
  visualIndex = '';
  @property({ reflect: false, attribute: false })
  visualTitle = '';
  @property({ reflect: false, attribute: false })
  visualCopy = '';
  @property({ reflect: false, attribute: false })
  packageMatrixLabel = '';
  @property({ reflect: false, attribute: false })
  productBoundaryMeta = '';
  @property({ reflect: false, attribute: false })
  releaseDisciplineLabel = '';
  @property({ reflect: false, attribute: false })
  v10PostureMeta = '';
  @property({ reflect: false, attribute: false })
  noDriftLabel = '';
  @property({ reflect: false, attribute: false })
  noDriftCopy = '';
  @property({ reflect: false, attribute: false })
  noGhostsLabel = '';
  @property({ reflect: false, attribute: false })
  noGhostsCopy = '';
  @property({ reflect: false, attribute: false })
  noFogLabel = '';
  @property({ reflect: false, attribute: false })
  noFogCopy = '';
  @property({ reflect: false, attribute: false })
  architecture = '';
  @property({ reflect: false, attribute: false })
  changelog = '';
  @property({ reflect: false, attribute: false })
  deployment = '';

  render() {
    return (
      <main>
        <open-reading-shell rail footer metadata={this.metadata}>
          <div slot='rail'>
            <open-page-rail items={this.railItems}></open-page-rail>
          </div>

          <section id='release-line'>
            <open-section-frame>
              <span slot='index'>{this.releaseLineIndex}</span>
              <span slot='title'>{this.releaseLineTitle}</span>
              <span slot='copy'>{this.releaseLineCopy}</span>
              <div class='now-callout'>
                <open-badge tone='warning'>{this.freezeBadge}</open-badge>
                <p class='now-title'>{this.nowTitle}</p>
                <p class='now-copy'>{this.nowCopy}</p>
              </div>
              <div class='roadmap-grid'>
                <div class='timeline' aria-label={this.timelineAria}>
                  {this.timeline.map((phase) => (
                    <div class={phase.rowClass} key={phase.key}>
                      <span class='tl-node' aria-hidden='true'></span>
                      <div class='tl-head'>
                        <span class='tl-version'>{phase.version}</span>
                        <span class={phase.stampClass}>{phase.stampLabel}</span>
                        <span class='tl-theme'>{phase.theme}</span>
                      </div>
                      <p class='tl-copy'>{phase.copy}</p>
                      <span class='tl-status'>{phase.status}</span>
                    </div>
                  ))}
                </div>
                <aside class='rule-callout'>
                  <p class='rule-title'>{this.designRuleTitle}</p>
                  <p class='rule-text'>{this.designRuleText}</p>
                </aside>
              </div>
            </open-section-frame>
          </section>

          <section id='product-boundary'>
            <open-section-frame>
              <span slot='index'>{this.boundaryIndex}</span>
              <span slot='title'>{this.boundaryTitle}</span>
              <span slot='copy'>{this.boundaryCopy}</span>
              <div class='truth-grid'>
                <open-artifact-panel class='truth'>
                  <span slot='label'>{this.inProductLabel}</span>
                  <h2>{this.inProductTitle}</h2>
                  <ul>
                    {this.inProductItems.map((item) => <li key={item.key}>{item.value}</li>)}
                  </ul>
                </open-artifact-panel>

                <open-artifact-panel class='truth'>
                  <span slot='label'>{this.outScopeLabel}</span>
                  <h2>{this.outScopeTitle}</h2>
                  <ul>
                    {this.outScopeItems.map((item) => <li key={item.key}>{item.value}</li>)}
                  </ul>
                </open-artifact-panel>

                <open-artifact-panel class='truth'>
                  <span slot='label'>{this.siteRuleLabel}</span>
                  <h2>{this.siteRuleTitle}</h2>
                  <p>{this.siteRuleText}</p>
                </open-artifact-panel>
              </div>
            </open-section-frame>
          </section>

          <section id='decision-matrix'>
            <open-section-frame>
              <span slot='index'>{this.matrixIndex}</span>
              <span slot='title'>{this.matrixTitle}</span>
              <span slot='copy'>{this.matrixCopy}</span>
              <div class='matrix'>
                <div class='matrix-row'>
                  <span class='metric-label'>{this.shipLabel}</span>
                  <span class='matrix-copy'>{this.shipCopy}</span>
                </div>
                <div class='matrix-row'>
                  <span class='metric-label'>{this.proveLabel}</span>
                  <span class='matrix-copy'>{this.proveCopy}</span>
                </div>
                <div class='matrix-row'>
                  <span class='metric-label'>{this.freezeLabel}</span>
                  <span class='matrix-copy'>{this.freezeCopy}</span>
                </div>
              </div>
            </open-section-frame>
          </section>

          <section id='system-visual'>
            <open-section-frame>
              <span slot='index'>{this.visualIndex}</span>
              <span slot='title'>{this.visualTitle}</span>
              <span slot='copy'>{this.visualCopy}</span>
              <div class='visual-grid'>
                <open-artifact-panel>
                  <span slot='label'>{this.packageMatrixLabel}</span>
                  <span slot='meta'>{this.productBoundaryMeta}</span>
                  <open-standards-visual variant='packages' emphasis='high' motion='auto'>
                  </open-standards-visual>
                </open-artifact-panel>
                <open-artifact-panel>
                  <span slot='label'>{this.releaseDisciplineLabel}</span>
                  <span slot='meta'>{this.v10PostureMeta}</span>
                  <ul class='rule-list'>
                    <li>
                      <strong class='rule-label'>{this.noDriftLabel}</strong>
                      <span class='rule-copy'>{this.noDriftCopy}</span>
                    </li>
                    <li>
                      <strong class='rule-label'>{this.noGhostsLabel}</strong>
                      <span class='rule-copy'>{this.noGhostsCopy}</span>
                    </li>
                    <li>
                      <strong class='rule-label'>{this.noFogLabel}</strong>
                      <span class='rule-copy'>{this.noFogCopy}</span>
                    </li>
                  </ul>
                </open-artifact-panel>
              </div>
            </open-section-frame>
          </section>

          <nav class='nav-row' slot='footer'>
            <open-button href='/architecture/architecture'>{this.architecture}</open-button>
            <open-button href='/changelog'>{this.changelog}</open-button>
            <open-button href='/guide/deployment'>{this.deployment}</open-button>
          </nav>
        </open-reading-shell>
      </main>
    );
  }
}
