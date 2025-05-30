"use strict";

(async () => {
	if (!getPageStatus().access) return;

	const feature = featureManager.registerFeature(
		"Ranked War Filter",
		"faction",
		() => settings.pages.faction.rankedWarFilter,
		initialiseFilters,
		addFilters,
		removeFilters,
		{
			storage: ["settings.pages.faction.rankedWarFilter"],
		},
		null
	);

	function initialiseFilters() {
		document.addEventListener("click", async (event) => {
			const rankedWarItem = event.target.closest("[class*='warListItem__']");
			if (rankedWarItem && rankedWarItem.find(":scope > [data-warid]")) {
				addFilters(
					(await requireElement(".descriptions .faction-war .enemy-faction", { parent: rankedWarItem.parentElement })).closest(".faction-war")
				).catch(console.error);
			}
		});

		CUSTOM_LISTENERS[EVENT_CHANNELS.STATS_ESTIMATED].push(({ row }) => {
			if (!feature.enabled()) return;

			if (!row.closest(".faction-war")) {
				// Estimate didn't happen in a ranked war list.
				return;
			}

			const content = findContainer("Ranked War Filter", { selector: "main" });
			const statsEstimates = localFilters["Stats Estimate"]?.getSelections(content);
			if (!statsEstimates?.length) return;

			filterRow(row, { statsEstimates }, true);
		});

		addFetchListener(({ detail: { page, fetch } }) => {
			if (!feature.enabled()) return;

			if (page === "page" && new URL(fetch.url).searchParams.get("sid") === "factionsRankedWarring") filtering();
		});
	}

	let interval;
	const localFilters = {};

	async function addFilters(rankedWarList) {
		if (interval) {
			clearInterval(interval);
			interval = null;
		}

		if (location.hash.includes("#/war/rank")) rankedWarList = await requireElement(".act[class*='warListItem__'] ~ .descriptions .faction-war");
		if (!rankedWarList) return;

		interval = setInterval(() => filtering(), 2500);

		const { content } = createContainer("Ranked War Filter", {
			nextElement: rankedWarList,
			compact: true,
			filter: true,
			applyRounding: false,
		});

		const statistics = createStatistics("players");
		content.appendChild(statistics.element);
		localFilters["Statistics"] = { updateStatistics: statistics.updateStatistics };

		const filterContent = document.newElement({
			type: "div",
			class: "content",
		});

		const activityFilter = createFilterSection({
			type: "Activity",
			defaults: filters.factionRankedWar.activity,
			callback: () => filtering(),
		});
		filterContent.appendChild(activityFilter.element);
		localFilters["Activity"] = { getSelections: activityFilter.getSelections };

		const statusFilter = createFilterSection({
			title: "Status",
			checkboxes: [
				{ id: "okay", description: "Okay" },
				{ id: "hospital", description: "Hospital" },
				{ id: "abroad", description: "Abroad" },
				{ id: "traveling", description: "Traveling" },
			],
			defaults: filters.factionRankedWar.status,
			callback: () => filtering(),
		});
		filterContent.appendChild(statusFilter.element);
		localFilters["Status"] = { getSelections: statusFilter.getSelections };

		const levelFilter = createFilterSection({
			type: "LevelPlayer",
			typeData: {
				valueLow: filters.factionRankedWar.levelStart,
				valueHigh: filters.factionRankedWar.levelEnd,
			},
			callback: () => filtering(),
		});
		filterContent.appendChild(levelFilter.element);
		localFilters["Level Filter"] = { getStartEnd: levelFilter.getStartEnd, updateCounter: levelFilter.updateCounter };

		if (settings.scripts.statsEstimate.global && settings.scripts.statsEstimate.rankedWars && hasAPIData()) {
			const estimatesFilter = createFilterSection({
				title: "Stats Estimates",
				checkboxes: [
					{ id: "none", description: "none" },
					...RANK_TRIGGERS.stats.map((trigger) => ({ id: trigger, description: trigger })),
					{ id: "n/a", description: "N/A" },
				],
				defaults: filters.factionRankedWar.estimates,
				callback: () => filtering(),
			});
			filterContent.appendChild(estimatesFilter.element);

			localFilters["Stats Estimate"] = { getSelections: estimatesFilter.getSelections };
		}

		content.appendChild(filterContent);

		await filtering();
	}

	async function filtering() {
		const membersWrap = await requireElement(".faction-war[class*='membersWrap__']");

		const content = findContainer("Ranked War Filter");
		const activity = localFilters["Activity"].getSelections(content);
		const status = localFilters["Status"].getSelections(content);
		const levels = localFilters["Level Filter"].getStartEnd(content);
		const levelStart = parseInt(levels.start);
		const levelEnd = parseInt(levels.end);
		const statsEstimates =
			hasStatsEstimatesLoaded("Faction Ranked Wars") && settings.scripts.statsEstimate.global && settings.scripts.statsEstimate.rankedWars && hasAPIData()
				? localFilters["Stats Estimate"]?.getSelections(content)
				: undefined;

		// Update level slider counters
		localFilters["Level Filter"].updateCounter(`Level ${levelStart} - ${levelEnd}`, content);

		// Save filters
		await ttStorage.change({
			filters: {
				factionRankedWar: {
					activity: activity,
					levelStart: levelStart,
					levelEnd: levelEnd,
					status: status,
					estimates: statsEstimates ?? filters.factionRankedWar.estimates,
				},
			},
		});

		// Actual Filtering
		for (const li of membersWrap.findAll(".members-list > li")) {
			filterRow(li, { activity, status, level: { start: levelStart, end: levelEnd }, statsEstimates }, false);
		}

		triggerCustomListener(EVENT_CHANNELS.FILTER_APPLIED, { filter: "Ranked War Filter" });

		localFilters["Statistics"].updateStatistics(
			membersWrap.findAll(".members-list > li:not(.tt-hidden)").length,
			membersWrap.findAll(".members-list > li").length,
			content
		);
	}

	function filterRow(row, filters, individual) {
		if (filters.activity) {
			const activity = row.find("[class*='userStatusWrap___'] svg").getAttribute("fill").match(FILTER_REGEXES.activity_v2_svg)[0];
			if (filters.activity.length && !filters.activity.some((x) => x.trim() === activity)) {
				hide("activity");
				return;
			}
		}
		if (filters.status?.length) {
			const statusElement = row.find(".status");

			if (!filters.status.some((s) => statusElement.classList.contains(s))) {
				hide("status");
				return;
			}
		}
		if (filters.level) {
			const level = parseInt(row.find(".level").textContent);
			if ((filters.level.start && level < filters.level.start) || (filters.level.end !== 100 && level > filters.level.end)) {
				hide("level");
				return;
			}
		}
		if (filters.statsEstimates) {
			if (filters.statsEstimates.length) {
				const estimate = row.dataset.estimate?.toLowerCase() ?? "none";
				if ((estimate !== "none" || !row.classList.contains("tt-estimated")) && !filters.statsEstimates.includes(estimate)) {
					hide("stats-estimate");
					return;
				}
			}
		}

		show();

		function show() {
			row.classList.remove("tt-hidden");
			delete row.dataset.hideReason;

			if (row.nextElementSibling?.classList.contains("tt-stats-estimate")) {
				row.nextElementSibling.classList.remove("tt-hidden");
			}

			if (individual) {
				const content = findContainer("Ranked War Filter", { selector: "main" });

				localFilters["Statistics"].updateStatistics(
					document.findAll(".faction-war[class*='membersWrap__'] .members-list > li:not(.tt-hidden)").length,
					document.findAll(".faction-war[class*='membersWrap__'] .members-list > li").length,
					content
				);
			}
		}

		function hide(reason) {
			row.classList.add("tt-hidden");
			row.dataset.hideReason = reason;

			if (row.nextElementSibling?.classList.contains("tt-stats-estimate")) {
				row.nextElementSibling.classList.add("tt-hidden");
			}

			if (individual) {
				const content = findContainer("Ranked War Filter", { selector: "main" });

				localFilters["Statistics"].updateStatistics(
					document.findAll(".faction-war[class*='membersWrap__'] .members-list > li:not(.tt-hidden)").length,
					document.findAll(".faction-war[class*='membersWrap__'] .members-list > li").length,
					content
				);
			}
		}
	}

	function removeFilters() {
		removeContainer("Ranked War Filter");
		document.findAll(".faction-war[class*='membersWrap__'] .tt-hidden").forEach((x) => x.classList.remove("tt-hidden"));
	}
})();
