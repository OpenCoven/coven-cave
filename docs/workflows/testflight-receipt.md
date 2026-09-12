# Read-only TestFlight availability receipt

After the release workflow uploads an iOS build, dispatch from `main`:

```bash
gh workflow run testflight-receipt.yml --ref main \
  -f marketing_version=0.4.2 -f build_number=2026090912
gh run list --workflow testflight-receipt.yml --limit 5
gh run download <run-id> --name testflight-receipt --dir <receipt-directory>
```

This is independent of release publication: it does not upload, tag, release,
invite testers, assign groups, or change Apple distribution. It reads only
`ai.opencoven.cave` on `IOS`, requiring an exact marketing version, build number,
and matching app/pre-release-version relationships. No version stamps change.

The manually dispatched workflow uses the same pinned actions and authorized
`APPLE_API_KEY`, `APPLE_API_KEY_BASE64`, `APPLE_API_ISSUER` secrets as `release.yml`.
`APPLE_API_KEY_SUBJECT=user` selects an individual key (`sub: user`, no `iss`);
an unset subject selects a team key with an issuer. Private-key material stays
in memory. Each five-minute ES256 JWT is scoped to one GET request. Neither
tokens nor keys are printed, written to disk, or included in artifacts.
Do not retrieve CI secrets or use local keys to work around authorization errors.

The key ID is a bounded identifier, not a fixed ten-character value: Apple's
JWT documentation gives an example, not a length requirement. The receipt
preserves the configured ID and accepts 1-128 ASCII letters, digits, underscores,
or hyphens; Apple remains responsible for authenticating that ID and signature.
`INVALID_KEY_ID` is a local configuration failure before any Apple request,
not an Apple authorization denial or a statement about build availability.

The job summary and `testflight-receipt` JSON artifact (90-day retention) contain
query timestamps, exact selectors, resource IDs, processing and beta states,
assigned group IDs/types, and tester counts. Tester membership is read using the
IDs-only relationship endpoint; tester IDs, names and emails are never emitted.
Apple response bodies and arbitrary error messages are never logged.

Beta-detail identity is proven by reading the exact build's
`relationships/buildBetaDetail` ID and matching it to the returned detail.
Apple defines the inverse `build` relationship and its inline linkage as optional;
a links-only inverse or an empty to-one linkage (`data: null`) supplies no inverse
identity. When non-null inverse linkage is supplied, it must still match the exact
build. Missing, null or mismatched **forward** linkage remains an error.
`buildBetaDetailHasBuildLinkage` records whether non-null inverse linkage was
supplied, and `buildBetaDetailBuildLinkageState` distinguishes `omitted`, `empty`
and `present` without exposing response bodies. Neither replaces the mandatory
forward identity proof. Resource-type,
resource-ID and missing-linkage failures have distinct sanitized error codes.

| Verdict | Meaning |
| --- | --- |
| `ABSENT` | No exact app, iOS pre-release version, or build is visible. |
| `PROCESSING_PENDING` | Exact build is still processing; beta groups are not queried yet. |
| `VALID_NOT_AVAILABLE` | Processing is `VALID`, but no populated assigned group has its matching lane `IN_BETA_TESTING`. `READY_FOR_BETA_TESTING` is insufficient. |
| `TESTER_AVAILABLE` | Unexpired, `VALID` build has an assigned group with testers and matching internal/external state `IN_BETA_TESTING`. |
| `BLOCKED` | Failed/invalid processing, expiration, or an assigned group's compliance/rejection state prevents availability. |
| `UNKNOWN` | Unrecognized/missing state, inconsistent identity, bounded-query limit, configuration, transport or API error. |

Only `TESTER_AVAILABLE` exits successfully. All other outcomes fail the job but
preserve the receipt; a red job is not necessarily a tooling failure. A 401/403
is recorded as `APPLE_AUTHORIZATION_DENIED` with the HTTP status and is not
retried. Other transient HTTP failures have at most three attempts. Each response
is limited to 1 MiB; queries have 15-second request timeouts, ten pages per list,
100 total attempts and a four-minute query budget. Redirects are refused, the
HTTPS host is fixed, and pagination must preserve the endpoint and selectors.

This is a sequential API snapshot, not an atomic distribution transaction or
proof of invitation acceptance, device eligibility, or user installation.
No assigned group is inferred from processing alone. Rerun explicitly if Apple
has not finished processing; this workflow does not poll indefinitely.

## Apple API contract

- [JWT signing and individual/team claims](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- [Apps](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps)
- [Pre-release versions](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions)
- [Builds](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds)
- [Build beta detail](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-buildbetadetail)
- [Build beta detail ID linkage](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-buildbetadetail)
- [Build beta detail resource](https://developer.apple.com/documentation/appstoreconnectapi/buildbetadetail)
- [Internal states](https://developer.apple.com/documentation/appstoreconnectapi/internalbetastate) and [external states](https://developer.apple.com/documentation/appstoreconnectapi/externalbetastate)
- [Beta groups filtered by app and build](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups)
- [Tester relationship IDs](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-betatesters)
