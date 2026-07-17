# External Sign-in Web Forms: Threat and Deployment Model

Status: revised after live Goal 5 testing on July 17, 2026

## Product decision

VocaForm does not proxy Google or Microsoft credentials, passwords, MFA codes, passkeys, or provider cookies. A form that requires sign-in opens on the provider's own page in the user's browser.

The earlier remote credential-control prototype was removed after live testing showed that reconstructing provider identity flows was confusing and incomplete. Modern identity flows may depend on password managers, passkeys, device trust, conditional access, CAPTCHA, or provider-specific browser state. VocaForm is not an identity client and must not imitate one.

## Data flow

1. The user labels the responder link **Sign-in required**.
2. VocaForm opens the link in its existing read-only inspector and reads only question structure visible before authentication.
3. The returned responder URL is sanitized and stored as the external hand-off URL.
4. The user opens that URL in a separate provider tab and signs in directly with Google or Microsoft.
5. VocaForm conducts the interview and verification using its canonical answer state.
6. The final hand-off shows the reviewed answer list beside an **Open signed-in form** link. The user copies answers and submits in the provider tab.

There is no cookie, local-storage, credential, or session transfer between the provider tab and VocaForm. External sign-in therefore cannot use Goal 4 native filling; it always uses the guided manual hand-off.

## Security properties

- Provider credentials and MFA values never enter a VocaForm input, API request, process, log, trace, model prompt, canonical session, or Memory Vault.
- VocaForm never reads browser cookies, profiles, password-manager state, local storage, or an existing provider session.
- The inspector retains the existing non-persistent Chromium context, provider allowlist, sanitized URL policy, blocked writes, disabled submission, blocked downloads, blocked service workers, and blocked beacons.
- Opening the provider link transmits no VocaForm answers. Answers leave VocaForm only when the user manually copies them.
- Public forms may still use Goal 4's separately consented isolated native preparation. Externally signed-in forms cannot.

## Limitations and fail-closed behavior

- Some signed-in forms expose question structure while signed out; others expose nothing until authentication. If no usable questions are visible, VocaForm cannot build an interview and tells the user to complete the provider form directly.
- VocaForm cannot confirm that the external provider tab is signed in, still open, or showing the same revision. The user reviews the native form before copying or submitting.
- Organization policy, tenant consent, conditional access, CAPTCHA, passkeys, hardware keys, and data residency remain entirely within the provider's responsibility and user browser.
- An external tab may have an existing account session. VocaForm neither inspects nor changes it.

## Long-term companion extension boundary

The roadmap includes a provider-allowlisted browser extension to remove manual answer transfer for authenticated Google Forms and Microsoft Forms. The extension will operate only after a user gesture in the active responder tab, after provider authentication has finished. It will receive a reviewed, version-bound answer packet, fill and re-read supported controls, and stop before Submit.

This does not relax the credential boundary: the extension must not run on provider identity pages, read cookies or password-manager state, request broad browsing-history access, or transmit credentials to VocaForm. Extension absence, permission denial, provider drift, and unsupported controls retain the current manual hand-off.

## Verification

The Goal 5 browser journey verifies that:

- **Sign-in required** never renders a VocaForm password or MFA input;
- the server records `external` access and forces `guided_manual` delivery;
- the sanitized provider link opens with `target="_blank"` and `noopener noreferrer`;
- opening is user-controlled and no provider request occurs during inspection or interview rendering;
- the final action is **Open signed-in form**, paired with the reviewed manual answer list.
