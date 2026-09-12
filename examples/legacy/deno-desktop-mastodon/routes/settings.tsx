/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';

export const tagName = 'mastodon-settings';

@element('mastodon-settings', { root: 'shadow-open' })
export default class SettingsPage extends OpenElement {
  render() {
    return (
      <main class='mastodon-main'>
        <div class='mastodon-page-header'>
          <h1>Settings</h1>
          <p>Configure instance, theme, and timeline density.</p>
        </div>

        <div class='mastodon-card'>
          <settings-island />
        </div>

        <div class='mastodon-card'>
          <p class='mastodon-card-title'>Cache</p>
          <p class='mastodon-card-body'>
            Timeline, profile, and status data are cached locally with a short TTL. In live mode the
            cache reduces repeated network requests.
          </p>
        </div>
      </main>
    );
  }
}
