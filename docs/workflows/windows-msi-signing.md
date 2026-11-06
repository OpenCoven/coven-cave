# Windows MSI Authenticode signing

The Windows release job builds one MSI, checks its component and size budget,
signs it with SSL.com eSigner, verifies its Authenticode signer and timestamp,
then uploads, updater-signs and attests those exact signed bytes. Every MSI
through v0.5.18 was released before this gate was restored and is unsigned. Track activation in
[#5739](https://github.com/OpenCoven/coven-cave/issues/5739).

## Buy and enroll

1. Choose the publisher name. For a registered company, buy an SSL.com **OV Code
   Signing** certificate in that company's exact legal name. If the publisher
   is an individual, choose IV instead. EV is needed for kernel-mode drivers,
   which Cave does not ship. The Windows installer shows the validated subject,
   so do not order under a project or trade name the CA cannot validate.
2. On [SSL.com's eSigner for Code order page](https://www.ssl.com/products/software-integrity/signing-service/),
   choose a one-year code signing certificate, **eSigner Cloud Signing** for
   key storage, and the smallest subscription tier that covers expected signing
   volume. Do not choose document signing or a USB token for this CI path.
   Confirm the checkout total and renewal terms before paying; prices change.
3. In the SSL.com account's **Orders** page, provide the registrant and contact
   details for validation. For OV, be ready to prove the legal organization and
   answer SSL.com's validation callback. Select remote signing during issuance.
   SSL.com must complete validation before it can issue the certificate.
4. Open the validated order's **eSigner Cloud Signing Enrollment** section.
   Select **OTP APP**, create and retain the enrollment PIN, and issue the
   certificate. Capture the QR code's **secret code** in a secure password
   manager at that moment; it is shown only once and is needed for unattended
   CI signing. Enroll the authenticator app as well. Do not paste the QR code,
   password, PIN, or TOTP secret into an issue, PR, chat, or shell history.

SSL.com instructions: [purchase and pricing](https://www.ssl.com/products/software-integrity/signing-service/),
[validation](https://www.ssl.com/how-to/validation-process-for-document-signing-code-signing-and-ev-code-signing-certificates/),
[enrollment](https://www.ssl.com/how-to/enroll-esigner-remote-document-ev-code-signing/),
and [automation secret](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/).

## Configure the release repository

In [Cave's Actions secrets and variables](https://github.com/OpenCoven/coven-cave/settings/secrets/actions),
create these **repository secrets** from the same eSigner account and credential:

| Secret | Value |
| --- | --- |
| `ES_USERNAME` | SSL.com eSigner account username |
| `ES_PASSWORD` | SSL.com eSigner account password |
| `CREDENTIAL_ID` | Issued eSigner code-signing credential ID |
| `ES_TOTP_SECRET` | QR code's OAuth TOTP secret code, not a six-digit current OTP |

SSL.com's [CodeSignTool guide](https://www.ssl.com/guide/esigner-codesigntool-command-guide/)
describes `get_credential_ids` and `credential_info` if the credential ID is
not visible in the account. Enter credentials only in the SSL.com account or
GitHub secret UI. Do not run the documented example with real passwords in a
shared shell, where command arguments and history may expose them.

Create one **repository variable** named `WINDOWS_SIGNING_CERT_THUMBPRINT`:
the issued public leaf certificate's SHA-1 thumbprint, exactly 40 hex digits
without spaces. Read it from the issued certificate, or from a disposable
signed file on a trusted Windows machine using
`(Get-AuthenticodeSignature -LiteralPath .\signed-sample.exe).SignerCertificate.Thumbprint`.
Confirm the subject is the intended publisher before saving the value. This
thumbprint identifies the expected signer; it is not a secret. Recheck and
update it whenever SSL.com reissues or renews the certificate.

GitHub's [secret](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
and [variable](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)
guides cover the repository settings UI. Do not merge the signing gate or start
a release until all five inputs are present and the validated publisher name
is confirmed. Check presence by name only:

```bash
gh api repos/OpenCoven/coven-cave/actions/secrets --jq '.secrets[].name'
gh api repos/OpenCoven/coven-cave/actions/variables --jq '.variables[].name'
```

## What the gate enforces

| Step | Fails when |
| --- | --- |
| Require Windows signing configuration | any of the five inputs is empty, or the thumbprint is not 40 hex digits; runs before the MSI build |
| Verify Windows signing tool | the CodeSignTool archive SHA-256 differs from the pinned value |
| Verify signed Windows MSI | Authenticode status is not `Valid`, the signer thumbprint differs, there is no timestamp, or the signed MSI breaks the budget |
| Publish verified signed Windows MSI | the MSI hash changed since verification, or GitHub's uploaded asset digest differs |
| Recheck before updater signing and attestation | another MSI appears under the bundle directory, or the hash changed |

The verified SHA-256 is recorded once, as `WINDOWS_MSI_SHA256`, and every later
step compares against it. A `windows_diagnostics_only` dispatch skips every
row above and still builds and measures the unsigned MSI.

## Activate and prove

After enrollment, merge the reviewed signing-gate PR. First run the Windows
diagnostics-only release dispatch to check the build budget without publishing;
that mode intentionally skips signing. Then perform a controlled signed release
through the existing candidate and final release sequence. The Windows job
must report a valid Authenticode signature, matching certificate thumbprint,
timestamp, signed MSI budget, and exact-byte upload/attestation. Inspect the
downloaded public MSI with `Get-AuthenticodeSignature` on Windows. Only then
describe the Windows download as code-signed on the landing page and in notes.
