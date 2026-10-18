GUI-STARTUP-CHECK-SIZES — PASS, Codex 3, 18 October 2026

Native Check model settings returned:

> Model file checked: Qwen 3.8 27B — INT. 2 model copies. 27.5 GiB of graphics-card conversation memory per model copy. This check did not start a model.

S1 GPU1, RTX PRO 6000; private dev catalog http://192.168.1.109:18761/catalog.json. Exact released TP1 input was registered read-only from the NAS. The catalog package SHA-256 is bcf29abd1598f5666c641da7c59ac28bd999aa98a8d6ba533ae7aa579abd06a7. No model was copied or loaded.

The native development app/Host were rebuilt at 66e766a4363980e28f412c8e072d0ff33c714275. Its actual artifact-scoped schema-2 profile completed in 143.836 seconds. Native XTest selected only GPU1, full default context 262144, one request, two copies, automatic memory, Vision and structured outputs enabled, speculation off. Clicking Check produced the actual Host response; read-only inspection retained it without a second quote call. 29532118784 bytes formats as 27.5 GiB. No raw byte count or instance(s) placeholder appears. The final Host snapshot has zero instances. Screenshot native-check-result.png was visually reviewed.

The existing ONE gate at 1062ba9f8 covers the unchanged result wording/formatter and 69 Host-model plus 48 model-release cases. No repeated source gate; this evidence/docs branch uses git diff --check. The first Docker GUI launch stopped before the app because an environment option preceded run; corrected option placement reused the same build and private display. Linux native dev acceptance only; no installer, Windows, quality or performance qualification.

Private app and Host stopped; returned 11:08Z. The owned S1 SSD root was removed. Only small result/quote JSON, this summary and the screenshot remain; protected donor resources, the catalog service and released NAS input were left intact.
