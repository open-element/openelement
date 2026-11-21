/**
 * wc-open-native — openElement child created inside a bare-native custom
 * element's own open shadow root, after activation (A4 of the late-host
 * corpus).
 *
 * The "no framework" control: if the mechanism only worked for library-built
 * hosts, this case would fail while every library case passed, which is
 * exactly the distinction the corpus exists to make.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`: the qualifier reaches the marker through
 * `wc-native-late-host`'s shadow root and then this element's, so a light root
 * would move the marker into a light DOM that walk does not read.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenNative() {
  return <span id='open-native-ready'>openElement child inside a native element</span>;
}
