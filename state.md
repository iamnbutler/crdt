u:26-06-01|rid:26737661647|restraint:23|monthly:#316(renamed→June)|maint-silent:26-03-29(64d)
HOLD:no-new-PRs/comments,monthly-only(17-TI-PRs-stale,none-merged;#162 dropped off list)
**DUP-EXPLOSION**:37 open "Monthly Activity" issues(daily-created,not-updated)!root=MCP issue_read/search_issues/list_issues ALL return empty→run cant find existing→creates new daily
this-run:repurposed #316→2026-06(rename+replace body)instead of 38th dup;Suggested-Actions=bulk-close dups+triage17PRs
DUPS-may:313,309,306,303|apr:296,293,290,288,285,283,280,278,275,273,271,266,261,259,257,255,252,248,246,244,240,238,232,228,226,222|mar:219,215,195,170,163,129 (36 to close;keep #316)
main:9ffb0f3(unchanged)|test:3965p/1f@last-val26-05-25(bun NOT installed this run,tree unchanged→status holds;skip-count7x)
TIprs17:320,315,312,308,302,268,264,254,251,243,237,234,231,225,221,218,194
i139item3-pend(perf69→103→118ms)|1-failing-test-uninvestigated(surface,dont-spawn-bug-issue under HOLD)
mcp:issue_read=empty,search_issues=empty,list_issues=empty ALL BROKEN;use curl(works,unauth public reads);list_PRs=huge(jq file)
push_repo_memory=FALSE-POS(reports~31KB regardless;env overhead;auto-push works,dont fight)
NOTE:renaming #316 wont stop tomorrows run making new June dup(workflow bug,cant fix from here);surfaced to maintainer