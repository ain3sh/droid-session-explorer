<papercuts>
Papercuts are small, avoidable bits of workflow friction worth sanding down.
When one genuinely costs time, log it: `dsx papercut add "what happened and the likely fix"`.
Use judgment: failures and guardrails are not papercuts when the workflow behaved as intended.
Keep it concrete, avoid duplicates, and continue the task.
Run `dsx papercut review <session>` only when the user asks; add `--save` to persist findings.
</papercuts>

<recovery>
After two failed attempts at the same operational or tooling problem, search `dsx` before a third.
Query the exact error or distinctive symptom in the current project, then inspect the best prior session.
Prefer a proven prior fix over another speculative workaround.
</recovery>
