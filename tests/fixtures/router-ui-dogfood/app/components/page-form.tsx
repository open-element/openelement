/**
 * /form page — qualifies open-input + open-button form participation on the
 * compiled framework (#1226):
 * - open-input is form-associated (ElementInternals.setFormValue), so a real
 *   <form> submission carries its value;
 * - required + empty value maps to valueMissing on the host validity;
 * - formResetCallback clears the value; formDisabledCallback mirrors a
 *   disabled fieldset ancestor;
 * - open-button type="submit" runs the composed-submit choreography.
 * The form-probe island wires the observable: it writes the submission's
 * FormData entries into #form-output.
 *
 * `#invalid` and `#native-disabled` sit OUTSIDE the form on purpose: they
 * qualify the control surface's invalid and disabled seats
 * (e2e/ui-input-control.spec.ts), and a form-associated control inside
 * #dogfood-form would change the FormData the participation specs assert.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-button';
import '@openelement/ui/open-input';

@element('form-page', { root: 'shadow-open' })
export default class FormPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — form</h1>
        <form id='dogfood-form'>
          <open-input id='username' name='username' label='Username' required></open-input>
          <open-input
            id='email'
            name='email'
            type='email'
            label='Email'
            value='ada@example.com'
          >
          </open-input>
          <fieldset id='locked-group' disabled>
            <open-input id='locked' name='locked' label='Locked'></open-input>
          </fieldset>
          <open-button id='submit-open' type='submit'>Submit via open-button</open-button>
          <button id='submit-native' type='submit'>Native submit</button>
          <button id='reset-native' type='reset'>Native reset</button>
        </form>
        <open-input id='invalid' label='Invalid' error='Required field'></open-input>
        <open-input id='native-disabled' label='Off' disabled></open-input>
        {/* open-button's disabled contract, BOTH shapes, as real SSR entities
            (e2e/ui-button.spec.ts). They live outside #dogfood-form on purpose:
            a static disabled control inside it would change the FormData the
            participation specs assert. */}
        <open-button id='button-disabled' disabled>Disabled</open-button>
        <open-button id='link-disabled' href='/roadmap/' disabled>Disabled link</open-button>
        <open-button id='button-enabled'>Enabled</open-button>
        <form-probe></form-probe>
        <output id='form-output'></output>
      </main>
    );
  }
}
