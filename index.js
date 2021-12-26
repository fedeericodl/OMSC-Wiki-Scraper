const cheerio = require("cheerio");
const tabletojson = require("tabletojson").Tabletojson;
const countryEmoji = require("country-emoji");
const fs = require("fs");
const { request } = require("./utils");

const BASE_URL = "https://onlinemusicsongcontest.miraheze.org/wiki/";
const COUNTRIES_WIKI_A = "List_of_countries_in_the_Online_Music_Song_Contest_(A-L)";
const COUNTRIES_WIKI_B = "List_of_countries_in_the_Online_Music_Song_Contest_(M-Z)";
const MEMBERS_WIKI = "List_of_members_in_the_Online_Music_Song_Contest";

fs.mkdir("./dist", {
	recursive: true
}, (error) => {
	if (error) throw error;
});

(async () => {
	const [websourceCountriesA, websourceCountriesB, websourceMembers] = await request(BASE_URL + COUNTRIES_WIKI_A, BASE_URL + COUNTRIES_WIKI_B, BASE_URL + MEMBERS_WIKI);

	function extract() {
		const extractedItems = [];

		for (let i = 0; i < arguments.length; i++) {
			const websource = arguments[i];
			const $ = cheerio.load(websource);
			let extracted = [];

			/*
				Gets the countries based on classes `thumbborder` and `new` (in particular class `new` is for images that do not exist yet on the page)
			*/
			$(".thumbborder, .new").each((_, element) => {
				const fullString = $(element).parent().text();
				const flagName = $(element).attr("alt")?.replace("Flag.png", "");

				if (fullString.includes("•")) {
					const string = fullString.replace("•  ", "").replace("• 25px ", "").replace(/\n/g, "").trim();
					extracted.push([string, flagName]);
				}
			});

			extracted = Array.from(new Set(extracted.map(JSON.stringify)), JSON.parse);
			extracted.sort(function (a, b) {
				a = a[0].toLowerCase();
				b = b[0].toLowerCase();
				if (a.normalize("NFD").match(/[\u0300-\u036f]/g) || b.normalize("NFD").match(/[\u0300-\u036f]/g)) return 0;
				if (a > b) return 1;
				if (a < b) return -1;
				return 0;
			});

			extractedItems.push(extracted);
		}

		return extractedItems;
	}

	const [countriesA, countriesB, members] = extract(websourceCountriesA, websourceCountriesB, websourceMembers);
	const countries = [...countriesA, ...countriesB];

	let totalStats = new Map();
	let averageStats = new Map();
	let averagePlaces = new Map();

	const [tablesCountriesA, tablesCountriesB] = [await tabletojson.convertUrl(BASE_URL + COUNTRIES_WIKI_A), await tabletojson.convertUrl(BASE_URL + COUNTRIES_WIKI_B)];
	const tablesCountries = [...tablesCountriesA, ...tablesCountriesB];
	const tablesMembers = await tabletojson.convertUrl(BASE_URL + MEMBERS_WIKI);
	tablesCountries.forEach((array) => {
		let totalPoints = 0;
		let count = 0;
		let averagePoints = 0;
		array.forEach((column) => {
			let points = parseInt(column.Points);
			if (!column.Points.match(/[^0-9.]/g) && points) {
				totalPoints += points;
				count++;
			}
		});
		averagePoints = Math.round((totalPoints / count) * 10) / 10;

		const index = tablesCountries.indexOf(array);
		const country = countries[index][0];
		if (totalPoints !== 0) {
			totalStats.set(country, totalPoints);
			averageStats.set(country, averagePoints);
		}
	});
	tablesMembers.forEach((array) => {
		let totalPlace = 0;
		let count = 0;
		let countTotal = 0;
		let averagePlace = 0;
		array.forEach((column) => {
			countTotal++;
			if (!column["GF Points"] && !column["SF Points"]) return;
			let place = parseInt(column["GF Place"]);
			if (place) {
				totalPlace += place;
				count++;
			}
		});
		averagePlace = Math.round((totalPlace / count) * 10) / 10;
		
		const index = tablesMembers.indexOf(array);
		const member = members[index][0];
		const flagName = members[index][1];
		if (totalPlace !== 0) averagePlaces.set(member, [averagePlace, flagName, countTotal >= 15]);
	});
	totalStats = new Map([...totalStats.entries()].sort(function (a, b) {
		return b[1] - a[1];
	}));
	averageStats = new Map([...averageStats.entries()].sort(function (a, b) {
		return b[1] - a[1];
	}));
	averagePlaces = new Map([...averagePlaces.entries()].sort(function (a, b) {
		return a[1][0] - b[1][0];
	}));

	let formattedMessage = "";
	let map = null;
	let count = 1;
	let prevPoints = 0;
	let countEqual = 0;

	function formatMessage(value, name) {
		const isMembersArray = Array.isArray(value);
		const emoji = (isMembersArray ? countryEmoji.flag(value[1]) : countryEmoji.flag(name)) || "❓";
		const isVeteran = (isMembersArray ? value[2] : false);
		if (isMembersArray) value = value[0];
		const nextIndex = Array.from(map.keys()).indexOf(name) + 1;
		const nextCountry = Array.from(map.keys())[nextIndex];
		const nextPoints = map.get(nextCountry);
		const pointsEqual = ((nextPoints === undefined ? undefined : (isMembersArray ? nextPoints[0] : nextPoints)) === value || prevPoints === value);
		const isPodium = (count <= 3 && !pointsEqual);

		if (count === 1 && !pointsEqual) {
			formattedMessage += "🥇";
		} else if (count === 2 && !pointsEqual) {
			formattedMessage += "🥈";
		} else if (count === 3 && !pointsEqual) {
			formattedMessage += "🥉";
		} else if (count > 3 || pointsEqual) {
			formattedMessage += `${pointsEqual ? count - countEqual : count}.`;
		}

		formattedMessage += ` ${pointsEqual ? "(=) " : ""}${isPodium ? "**" : ""}${emoji} ${name}${isVeteran ? " (Veteran)" : ""} - ${value}${isMembersArray ? "" : " points"}${isPodium ? "**" : ""}\n`;
		countEqual += (pointsEqual ? 1 : 0);
		countEqual = ((nextPoints === undefined ? undefined : (isMembersArray ? nextPoints[0] : nextPoints)) === value ? countEqual : 0);
		count++;
		prevPoints = value;
	}

	[formattedMessage, map, count, prevPoints, countEqual] = ["", totalStats, 1, 0, 0];
	totalStats.forEach(formatMessage);
	fs.writeFileSync("./dist/all-time-grand-final-results.txt", formattedMessage);

	[formattedMessage, map, count, prevPoints, countEqual] = ["", averageStats, 1, 0, 0];
	averageStats.forEach(formatMessage);
	fs.writeFileSync("./dist/average-scores-final.txt", formattedMessage);

	[formattedMessage, map, count, prevPoints, countEqual] = ["", averagePlaces, 1, 0, 0];
	averagePlaces.forEach(formatMessage);
	fs.writeFileSync("./dist/average-scores-members.txt", formattedMessage);
})();