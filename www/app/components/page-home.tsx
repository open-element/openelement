/** @jsxImportSource @openelement/element */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-code-block';
import '../islands/open-cinematic-scroll.tsx';
import '../islands/open-dragon-live-gaze.tsx';
import '../islands/open-hero-polish.tsx';
import { pageHomeStyles } from './page-home-styles.ts';

interface StrategyItem {
  key: string;
  className: string;
  glyph: string;
  name: string;
  tag: string;
  copy: string;
  uses: string;
}
interface OutputItem {
  key: string;
  className: string;
  name: string;
  description: string;
}
interface ReferenceItem {
  index: string;
  title: string;
  href: string;
  copy: string;
}

@element('index-index')
export default class PageHome extends OpenElement {
  static override styles = pageHomeStyles;

  @property({ reflect: false, attribute: false })
  lede = '';
  @property({ reflect: false, attribute: false })
  eyebrow = '';
  @property({ reflect: false, attribute: false })
  registryPrefix = '';
  @property({ reflect: false, attribute: false })
  packagesValue = '';
  @property({ reflect: false, attribute: false })
  enginesValue = '';
  @property({ reflect: false, attribute: false })
  depsValue = '';
  @property({ reflect: false, attribute: false })
  outputValue = '';
  @property({ reflect: false, attribute: false })
  badgeRuntime = '';
  @property({ reflect: false, attribute: false })
  badgeAuthoring = '';
  @property({ reflect: false, attribute: false })
  sceneElementIndex = '';
  @property({ reflect: false, attribute: false })
  sceneDsdIndex = '';
  @property({ reflect: false, attribute: false })
  sceneIslandsIndex = '';
  @property({ reflect: false, attribute: false })
  sceneOutputIndex = '';
  @property({ reflect: false, attribute: false })
  sceneBeginIndex = '';
  @property({ reflect: false, attribute: false })
  floodServer = '';
  @property({ reflect: false, attribute: false })
  floodBrowser = '';
  @property({ reflect: false, attribute: false })
  startBuilding = '';
  @property({ reflect: false, attribute: false })
  watchUnfold = '';
  @property({ reflect: false, attribute: false })
  getStarted = '';
  @property({ reflect: false, attribute: false })
  readGuide = '';
  @property({ reflect: false, attribute: false })
  specVersion = '';
  @property({ reflect: false, attribute: false })
  specGraph = '';
  @property({ reflect: false, attribute: false })
  specEngines = '';
  @property({ reflect: false, attribute: false })
  specDeps = '';
  @property({ reflect: false, attribute: false })
  specOutput = '';
  @property({ reflect: false, attribute: false })
  begin = '';
  @property({ reflect: false, attribute: false })
  beginNote = '';
  @property({ reflect: false, attribute: false })
  facts = '';
  @property({ reflect: false, attribute: false })
  continueComposition = '';
  @property({ reflect: false, attribute: false })
  referenceCopy = '';
  @property({ reflect: false, attribute: false })
  registryNote = '';
  @property({ reflect: false, attribute: false })
  commonVersionNote = '';
  @property({ reflect: false, attribute: false })
  marqueeText = '';
  @property({ reflect: false, attribute: false })
  heroMono = '';
  @property({ reflect: false, attribute: false })
  heroSerif = '';
  @property({ reflect: false, attribute: false })
  sceneElementLead = '';
  @property({ reflect: false, attribute: false })
  sceneElementAccent = '';
  @property({ reflect: false, attribute: false })
  sceneElementCopy = '';
  @property({ reflect: false, attribute: false })
  sceneDsdLead = '';
  @property({ reflect: false, attribute: false })
  sceneDsdAccent = '';
  @property({ reflect: false, attribute: false })
  sceneDsdCopy = '';
  @property({ reflect: false, attribute: false })
  sceneIslandsLead = '';
  @property({ reflect: false, attribute: false })
  sceneIslandsAccent = '';
  @property({ reflect: false, attribute: false })
  sceneIslandsCopy = '';
  @property({ reflect: false, attribute: false })
  sceneOutputLead = '';
  @property({ reflect: false, attribute: false })
  sceneOutputAccent = '';
  @property({ reflect: false, attribute: false })
  startBuildingHref = '';
  @property({ reflect: false, attribute: false })
  getStartedHref = '';
  @property({ reflect: false, attribute: false })
  docsHref = '';
  @property({ reflect: false, attribute: false })
  strategies: StrategyItem[] = [];
  @property({ reflect: false, attribute: false })
  outputs: OutputItem[] = [];
  @property({ reflect: false, attribute: false })
  references: ReferenceItem[] = [];

  render() {
    return (
      <div class='home' data-pagefind-body>
        <open-cinematic-scroll></open-cinematic-scroll>
        <open-hero-polish></open-hero-polish>
        <section class='hero'>
          <div class='hero-main'>
            <div class='hero-copy'>
              <p class='eyebrow'>{this.eyebrow}</p>
              <h1>
                <span class='mono-line'>{this.heroMono}</span>{' '}
                <span class='serif-line'>{this.heroSerif}</span>
              </h1>
            </div>
            <div class='hero-stage'>
              <open-dragon-live-gaze></open-dragon-live-gaze>
            </div>
            <div class='hero-foot'>
              <p class='lede'>
                {this.lede}
              </p>
              <div class='actions'>
                <a class='action primary' href={this.startBuildingHref}>{this.startBuilding}</a>
                <a class='action' href='#element'>{this.watchUnfold}</a>
              </div>
              <span class='scroll-cue' aria-hidden='true'>Scroll</span>
            </div>
          </div>
          <div class='spec-strip'>
            <div class='spec-cell'>
              <small>{this.specVersion}</small>
              <strong>{this.registryPrefix}{this.registryNote}</strong>
              <small>{this.commonVersionNote}</small>
            </div>
            <div class='spec-cell'>
              <small>{this.specGraph}</small>
              <strong>{this.packagesValue}</strong>
            </div>
            <div class='spec-cell'>
              <small>{this.specEngines}</small>
              <strong>{this.enginesValue}</strong>
            </div>
            <div class='spec-cell'>
              <small>{this.specDeps}</small>
              <strong class='accent'>{this.depsValue}</strong>
            </div>
            <div class='spec-cell'>
              <small>{this.specOutput}</small>
              <strong>{this.outputValue}</strong>
            </div>
          </div>
          <div class='marquee' aria-hidden='true'>
            <span>{this.marqueeText}</span>
          </div>
        </section>

        <section class='scene scene-split' id='element'>
          <span class='scene-outlined' aria-hidden='true'>01</span>
          <div class='scene-copy'>
            <p class='scene-index'>{this.sceneElementIndex}</p>
            <h2>
              {this.sceneElementLead}
              <span class='accent'>{this.sceneElementAccent}</span>
            </h2>
            <p>
              {this.sceneElementCopy}
            </p>
            <div class='badges'>
              <span class='badge'>{this.badgeRuntime}</span>
              <span class='badge'>{this.badgeAuthoring}</span>
            </div>
          </div>
          <div class='scene-art'>
            <open-code-block>
              <pre><code>{`import { element, OpenElement, property } from '@openelement/element'

@element('open-counter', { root: 'shadow-open' })
export class OpenCounter extends OpenElement {
  @property({ reflect: true, attribute: 'count', type: Number })
  count = 0

  render() {
    return (
      <button type="button">Count: {this.count}</button>
    )
  }
}

// SSR: <open-counter count="0"> + DSD shadow root.
// No JavaScript required for first paint.`}</code></pre>
            </open-code-block>
          </div>
        </section>

        <section class='scene flood'>
          <p class='scene-index'>{this.sceneDsdIndex}</p>
          <h2>
            {this.sceneDsdLead}
            <span class='accent'>{this.sceneDsdAccent}</span>
          </h2>
          <div class='scene-copy'>
            <p>
              {this.sceneDsdCopy}
            </p>
          </div>
          <div class='flood-panels'>
            <div class='flood-panel'>
              <small>{this.floodServer}</small>
              <code>
                {`<open-counter count="0">
  <template shadowrootmode="open">
    <button>0</button>
  </template>`}
              </code>
            </div>
            <span class='flood-arrow' aria-hidden='true'>⟶</span>
            <div class='flood-panel solid'>
              <small>{this.floodBrowser}</small>
              <span class='shadow-outline'>#shadow-root (open)</span>
              <code>
                {`└─ <button> → signal bound
   first paint = interactive`}
              </code>
            </div>
          </div>
        </section>

        <section class='scene'>
          <p class='scene-index'>{this.sceneIslandsIndex}</p>
          <h2>
            {this.sceneIslandsLead}
            <span class='accent'>{this.sceneIslandsAccent}</span>
          </h2>
          <div class='scene-copy'>
            <p>
              {this.sceneIslandsCopy}
            </p>
          </div>
          <div class='strategies'>
            {this.strategies.map((strategy) => (
              <div key={strategy.key} class={strategy.className}>
                <span class='glyph' aria-hidden='true'>{strategy.glyph}</span>
                <strong>
                  {strategy.name}
                  <span class='tag-default'>{strategy.tag}</span>
                </strong>
                <p>{strategy.copy}</p>
                <footer>{strategy.uses}</footer>
              </div>
            ))}
          </div>
        </section>

        <section class='scene'>
          <p class='scene-index'>{this.sceneOutputIndex}</p>
          <h2>
            {this.sceneOutputLead}
            <span class='accent'>{this.sceneOutputAccent}</span>
          </h2>
          <div class='output-rows'>
            {this.outputs.map((output) => (
              <div key={output.key} class={output.className}>
                <span class='name'>{output.name}</span>
                <span class='desc'>{output.description}</span>
                <span class='arrow' aria-hidden='true'>→</span>
              </div>
            ))}
          </div>
        </section>

        <section class='scene begin'>
          <p class='scene-index'>{this.sceneBeginIndex}</p>
          <h2>{this.begin}</h2>
          <div class='command'>
            <code>$</code>
            <span>
              deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt
              --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
            </span>
          </div>
          <p class='command-note'>{this.beginNote}</p>
          <div class='actions'>
            <a class='action primary' href={this.getStartedHref}>{this.getStarted}</a>
            <a class='action' href={this.docsHref}>{this.readGuide}</a>
          </div>
        </section>

        <section class='reference'>
          <header>
            <div>
              <p class='scene-index'>{this.facts}</p>
              <h2>{this.continueComposition}</h2>
            </div>
            <p>{this.referenceCopy}</p>
          </header>
          <div class='links'>
            {this.references.map((reference) => (
              <a key={reference.href} href={reference.href}>
                <span aria-hidden='true'>{reference.index}</span>
                <strong>{reference.title}</strong>
                <small>{reference.copy}</small>
              </a>
            ))}
          </div>
        </section>
      </div>
    );
  }
}
