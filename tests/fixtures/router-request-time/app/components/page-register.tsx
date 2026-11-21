/**
 * /register page element — zod validation recipe (compiled, v0.44). The route
 * action validates with zod; the framework stays validation-agnostic. The error
 * Block carries the constant zod message as static branch text.
 *
 * GENERATED lane (F16: class → function).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'register-page',
  root: 'shadow',
  properties: {
    email: { attribute: false, default: '' },
    welcomeText: { attribute: false, default: 'welcome=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface RegisterPageProps {
  email: string;
  welcomeText: string;
  hasError: number;
}

export default function RegisterPage(props: RegisterPageProps) {
  return (
    <main>
      <h1>register with zod</h1>
      <form method="post" data-open-enhance>
        <input id="email" name="email" type="text" value={props.email} />
        <button id="register" type="submit">
          Register
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">a valid email is required</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="welcome">{props.welcomeText}</p>
    </main>
  );
}
