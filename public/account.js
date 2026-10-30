// The account page (/account/): sign in with Google, choose your public name
// at the first sign-in or change it later, sign out here or everywhere, and
// delete the account. Accounts are optional; the routes are in
// server/accounts.js. ?return=/path is where signing in goes back to, and
// ?error=… why the last sign-in didn't work.
import { initShell, el, $, account, getNickname, toast } from "./engine/shell.js";
import { checkPublicName, nameKey, NAME_MAX, PUBLIC_NAME_MIN } from "./engine/names.js";

initShell();
const root = $("#account");
const params = new URLSearchParams(location.search);
// A path on this site; the server checks it again.
const back = /^\/(?![/\\])/.test(params.get("return") || "") ? params.get("return") : null;

const SIGN_IN_ERRORS = {
  cancelled: "Sign-in was cancelled. You can try again, or keep playing without an account.",
  state: "Sign-in took too long or was started in another tab. Please try again.",
  google: "Google's sign-in didn't work this time. Please try again.",
};
const NAME_PROBLEMS = {
  short: `At least ${PUBLIC_NAME_MIN} characters, please.`,
  long: `At most ${NAME_MAX} characters, please.`,
  link: "No links or @handles, please.",
  word: "Please pick a kinder name.",
  chars: "Only letters, numbers, spaces and . _ - ' are allowed.",
};
const ERRORS = {
  name_taken: "That name is taken. Try another one.",
  rate_limited: "Too many tries from your network. Please wait a few minutes.",
  signed_out: "You're signed out. Please sign in again.",
  confirm: "Type your public name exactly as it is to confirm.",
  unavailable: "Accounts aren't available right now. Please try again later.",
};

// A JSON request to the account routes: { status, ...body }.
async function api(method, path, body = {}) {
  try {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch {
    return { status: 0, error: "unavailable" };
  }
}

const errorText = (answer) => (answer.error === "bad_name" ? NAME_PROBLEMS[answer.problem] : ERRORS[answer.error]) ?? ERRORS.unavailable;

let firstView = true;
function view(...children) {
  root.replaceChildren(...children.filter(Boolean));
  root.removeAttribute("aria-busy");
  const heading = $("h1", root);
  heading.tabIndex = -1;
  if (!firstView) heading.focus();
  firstView = false;
}

const googleEmail = (email) => el("p", { class: "tagline" }, email ? ["Signed in with Google as ", el("strong", {}, email), "."] : "Signed in with Google.");

// A public name field with its rules checked as you type; onSubmit(name, show) gets the clean name.
function nameForm({ id, value, button, onSubmit, extra }) {
  const input = el("input", { id, type: "text", maxlength: String(NAME_MAX), autocomplete: "off", spellcheck: "false", value, "aria-describedby": `${id}-problem ${id}-hint`, required: true });
  const problem = el("small", { id: `${id}-problem`, class: "field-problem", "aria-live": "polite", hidden: true });
  const submit = el("button", { class: "btn primary", type: "submit" }, button);
  const show = (text) => {
    problem.textContent = text ?? "";
    problem.hidden = !text;
  };
  input.addEventListener("input", () => show(input.value.trim() && NAME_PROBLEMS[checkPublicName(input.value).problem]));
  const form = el(
    "form",
    {
      class: "account-name",
      onsubmit: async (e) => {
        e.preventDefault();
        const { name, problem: why } = checkPublicName(input.value);
        if (why) return show(NAME_PROBLEMS[why]), input.focus();
        submit.disabled = true;
        await onSubmit(name, show);
        submit.disabled = false;
      },
    },
    el(
      "label",
      { class: "field" },
      el("span", {}, "Public name"),
      input,
      problem,
      el("small", { id: `${id}-hint` }, `Shown to other players, and on leaderboards. ${PUBLIC_NAME_MIN} to ${NAME_MAX} characters, and nobody else can have it.`),
    ),
    el("div", { class: "account-actions" }, submit, extra),
  );
  return form;
}

function showUnavailable() {
  view(
    el("h1", {}, "Account"),
    el("p", { class: "tagline" }, "Accounts aren't available right now. Every game still works without one."),
    el("p", {}, el("a", { href: back ?? "/" }, "Back to the games")),
  );
}

function showSignIn(error) {
  const start = `/api/auth/google/start?return=${encodeURIComponent(back ?? "/account/")}`;
  view(
    el("h1", {}, "Sign in"),
    el("p", { class: "tagline" }, "An account is optional: every game works without one."),
    error && el("p", { class: "notice error", role: "alert" }, error),
    el("p", {}, "Signing in gives you a public name of your own: nobody else can take it, and leaderboards will show it."),
    el("div", { class: "account-actions" }, el("a", { class: "btn primary big", id: "sign-in-google", href: start }, "Sign in with Google")),
    el(
      "p",
      { class: "account-note" },
      "We keep your Google account ID, your email address and your public name, and a cookie keeps you signed in. ",
      el("a", { href: "/privacy/" }, "Privacy"),
    ),
  );
}

function showSignUp({ email }) {
  view(
    el("h1", {}, "Choose your public name"),
    googleEmail(email),
    nameForm({
      id: "public-name",
      value: getNickname(),
      button: "Create account",
      onSubmit: async (name, show) => {
        const answer = await api("POST", "/api/account", { name });
        if (answer.status !== 201) return show(errorText(answer));
        if (back && back !== "/account/") return location.assign(back);
        toast("Account created");
        showAccount(answer.user);
      },
      extra: el("button", { class: "btn ghost", type: "button", id: "cancel-sign-up", onclick: () => signOut("Sign-in cancelled") }, "Cancel"),
    }),
  );
}

function showAccount(user) {
  const confirmInput = el("input", { id: "delete-confirm", type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": "delete-problem" });
  const deleteBtn = el("button", { class: "btn danger", type: "submit", id: "delete-account", disabled: true }, "Delete account");
  const deleteProblem = el("small", { id: "delete-problem", class: "field-problem", "aria-live": "polite", hidden: true });
  const confirmName = el("strong", {}, user.name);
  confirmInput.addEventListener("input", () => (deleteBtn.disabled = nameKey(checkPublicName(confirmInput.value).name) !== nameKey(user.name)));
  view(
    el("h1", {}, "Your account"),
    googleEmail(user.email),
    nameForm({
      id: "public-name",
      value: user.name,
      button: "Save name",
      onSubmit: async (name, show) => {
        const answer = await api("PATCH", "/api/account", { name });
        if (answer.status !== 200) return show(errorText(answer));
        user = answer.user;
        confirmName.textContent = user.name;
        toast("Name saved");
      },
    }),
    el("h2", {}, "Signing out"),
    el(
      "div",
      { class: "account-actions" },
      el("button", { class: "btn", type: "button", id: "sign-out", onclick: () => signOut("Signed out") }, "Sign out"),
      el("button", { class: "btn", type: "button", id: "sign-out-everywhere", onclick: signOutEverywhere }, "Sign out everywhere"),
    ),
    el("p", { class: "account-note" }, "Sign out everywhere ends every session, on every device. Your nickname and settings on this device stay as they are."),
    el("h2", {}, "Delete your account"),
    el("p", {}, "This removes your account for good: your public name, your Google account ID and email address, and every session."),
    el(
      "form",
      {
        class: "account-delete",
        onsubmit: async (e) => {
          e.preventDefault();
          deleteBtn.disabled = true;
          const answer = await api("DELETE", "/api/account", { name: confirmInput.value });
          if (answer.status !== 200) {
            deleteProblem.textContent = errorText(answer);
            deleteProblem.hidden = false;
            deleteBtn.disabled = false;
            return;
          }
          toast("Account deleted");
          showSignIn();
        },
      },
      el("label", { class: "field" }, el("span", {}, "Type ", confirmName, " to confirm"), confirmInput, deleteProblem),
      el("div", { class: "account-actions" }, deleteBtn),
    ),
  );
}

async function signOut(message) {
  await api("POST", "/api/auth/signout");
  toast(message);
  showSignIn();
}

async function signOutEverywhere() {
  const answer = await api("POST", "/api/auth/signout-all");
  if (answer.status !== 200 && answer.error !== "signed_out") return toast(errorText(answer));
  toast("Signed out on every device");
  showSignIn();
}

const { accounts, user, signup } = await account();
if (!accounts) showUnavailable();
else if (user) showAccount(user);
else if (signup) showSignUp(signup);
else showSignIn(SIGN_IN_ERRORS[params.get("error")]);
