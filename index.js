const cheerio = require("cheerio");
const tabletojson = require("tabletojson").Tabletojson;
const countryEmoji = require("country-emoji");
const fs = require("fs");
const { request } = require("./utils");

const BASE_URL = "https://onlinemusicsongcontest.miraheze.org/wiki/";
const COUNTRIES_WIKI_A = "List_of_countries_in_the_Online_Music_Song_Contest_(A-L)";
const COUNTRIES_WIKI_B = "List_of_countries_in_the_Online_Music_Song_Contest_(M-Z)";
const MEMBERS_WIKI = "List_of_members_in_the_Online_Music_Song_Contest";

let currentEdition;
if (process.argv[2]?.startsWith("-edition:") && process.argv[2]?.length >= 10) {
	currentEdition = process.argv.join(" ").split("-edition:")[1];
}

fs.mkdir("./dist", { recursive: true }, (error) => {
	if (error) throw error;
});

(async () => {
	const [websourceCountriesA, websourceCountriesB, websourceMembers] = await request(
		BASE_URL + COUNTRIES_WIKI_A,
		BASE_URL + COUNTRIES_WIKI_B,
		BASE_URL + MEMBERS_WIKI
	);

	function extract() {
		const extractedItems = [];

		for (let i = 0; i < arguments.length; i++) {
			const websource = arguments[i];
			const $ = cheerio.load(websource);
			let extracted = [];

			/*
				Gets the countries based on classes `thumbborder` and `new`
				(`new` is for images that do not exist yet on the page)
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
			extracted.sort((a, b) => {
				a = a[0].toLowerCase();
				b = b[0].toLowerCase();
				if (a.normalize("NFD").match(/[\u0300-\u036f]/g) || b.normalize("NFD").match(/[\u0300-\u036f]/g))
					return 0;
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

	const [tablesCountriesA, tablesCountriesB] = [
		await tabletojson.convertUrl(BASE_URL + COUNTRIES_WIKI_A),
		await tabletojson.convertUrl(BASE_URL + COUNTRIES_WIKI_B)
	];
	const tablesCountries = [...tablesCountriesA, ...tablesCountriesB];
	const tablesMembers = await tabletojson.convertUrl(BASE_URL + MEMBERS_WIKI);

	tablesCountries.forEach((array) => {
		const filteredArray = array.filter((column) => !column.Points.match(/[^0-9.]/g) && parseInt(column.Points));
		const count = filteredArray.length;

		let totalPoints = 0;
		let averagePoints = 0;
		let newPoints = 0;

		filteredArray.forEach((column) => {
			const points = parseInt(column.Points);
			totalPoints += points;
			if (
				currentEdition &&
				column.Edition.includes(currentEdition) &&
				filteredArray.indexOf(column) === filteredArray.length - 1
			)
				newPoints = points;
		});
		averagePoints = Math.round((totalPoints / count) * 10) / 10;

		const index = tablesCountries.indexOf(array);
		const country = countries[index][0];

		if (totalPoints !== 0) {
			totalStats.set(country, [totalPoints, newPoints]);
			averageStats.set(country, [averagePoints, newPoints]);
		}
	});
	tablesMembers.forEach((array) => {
		const countTotal = array.length;

		let totalPlace = 0;
		let count = 0;
		let averagePlace = 0;
		let qRate = 0;

		array.forEach((column) => {
			if (!column["GF Points"] && !column["SF Points"]) return;
			const place = parseInt(column["GF Place"]);
			if (place) {
				totalPlace += place;
				count++;
			}
		});
		averagePlace = Math.round((totalPlace / count) * 10) / 10;
		qRate = Math.round((count / countTotal) * 100 * 10) / 10;

		const index = tablesMembers.indexOf(array);
		const member = members[index][0];
		const flagName = members[index][1];

		// Get new and next veterans
		if (countTotal === 15 || countTotal === 14)
			console.log("New:", countTotal === 15, "\t| Next New:", countTotal === 14, `[${member}]`);

		if (totalPlace !== 0) averagePlaces.set(member, [averagePlace, flagName, countTotal >= 15, qRate]);
	});
	totalStats = new Map([...totalStats.entries()].sort((a, b) => b[1][0] - a[1][0]));
	averageStats = new Map([...averageStats.entries()].sort((a, b) => b[1][0] - a[1][0]));
	averagePlaces = new Map([...averagePlaces.entries()].sort((a, b) => a[1][0] - b[1][0]));

	function formatMessage(map, isMembersArray) {
		let formattedMessage = "";
		let count = 1;
		let prevPoints = 0;
		let countEqual = 0;

		map.forEach((value, name) => {
			const emoji = (isMembersArray ? countryEmoji.flag(value[1]) : countryEmoji.flag(name)) || "❓";
			const isVeteran = value[2] && isMembersArray;
			const qRate = value[3];

			let diffFormat;
			if (!isMembersArray) {
				if (value[1] !== 0) {
					if (value[0] > value[1]) diffFormat = ` (+${value[1]})`;
					if (value[0] < value[1]) diffFormat = ` (-${value[1]})`;
				}
			}

			value = value[0];

			const nextIndex = Array.from(map.keys()).indexOf(name) + 1;
			const nextCountry = Array.from(map.keys())[nextIndex];
			const nextPoints = map.get(nextCountry);
			const pointsEqual = (nextPoints && nextPoints[0]) === value || prevPoints === value;
			const isPodium = count <= 3 && !pointsEqual;

			if (count === 1 && !pointsEqual) {
				formattedMessage += "🥇 ";
			} else if (count === 2 && !pointsEqual) {
				formattedMessage += "🥈 ";
			} else if (count === 3 && !pointsEqual) {
				formattedMessage += "🥉 ";
			} else if (count > 3 || pointsEqual) {
				formattedMessage += `${pointsEqual ? count - countEqual : count}. `;
			}

			if (pointsEqual) formattedMessage += "(=) ";
			if (isPodium) formattedMessage += "**";

			formattedMessage += `${emoji} ${name} `;

			if (isVeteran) formattedMessage += ":ServerVerifiedDark: ";

			formattedMessage += `- ${value} `;

			if (!isMembersArray) formattedMessage += "points";
			else formattedMessage += `(Q. ${qRate}%)`;

			if (diffFormat) formattedMessage += diffFormat;

			if (isPodium) formattedMessage += "**";
			formattedMessage += "\n";

			countEqual += pointsEqual ? 1 : 0;
			countEqual = (nextPoints && nextPoints[0]) === value ? countEqual : 0;
			count++;
			prevPoints = value;
		});

		return formattedMessage;
	}

	const [allTimeGFResults, averageFinal, averageMembers] = [
		formatMessage(totalStats),
		formatMessage(averageStats),
		formatMessage(averagePlaces, true)
	];

	fs.writeFileSync("./dist/all-time-grand-final-results.txt", allTimeGFResults);
	fs.writeFileSync("./dist/average-scores-final.txt", averageFinal);
	fs.writeFileSync("./dist/average-scores-members.txt", averageMembers);
})();
