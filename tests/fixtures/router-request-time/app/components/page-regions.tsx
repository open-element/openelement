/**
 * /regions page element — data-open-region / data-open-preserve morph semantics
 * (ADR-0121 §8), compiled v0.44. The `bannerText`/`message`/`hasError` props are
 * projected from request + action data by the route module's page descriptor.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` keeps the open DSD root
 * the region morph walks through.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'regions-page',
  root: 'shadow',
  properties: {
    bannerText: { attribute: false, default: 'echo=' },
    message: { attribute: false, default: '' },
    hasError: { attribute: false, default: 0 },
  },
});

interface RegionsPageProps {
  bannerText: string;
  message: string;
  hasError: number;
}

export default function RegionsPage(props: RegionsPageProps) {
  return (
    <main>
      <div data-open-region="banner">
        <p id="banner">{props.bannerText}</p>
      </div>
      <section data-open-region="form-area">
        <form method="post" data-open-enhance>
          <input id="message" name="message" type="text" value={props.message} />
          <button id="submit" type="submit">
            Send
          </button>
          <button id="missing" type="submit" data-open-region-target="no-such-region">
            Send to missing region
          </button>
        </form>
        {props.hasError > 0 ? (
          <p id="error">message is required</p>
        ) : (
          <span data-error="none"></span>
        )}
        <div id="preserved" data-open-preserve>
          <details id="preserved-details">
            <summary>keep me</summary>
            secret
          </details>
        </div>
      </section>
      <live-counter></live-counter>
    </main>
  );
}
