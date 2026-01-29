import * as cheerio from "cheerio";
import { flag } from "country-emoji";
import fs from "fs";
import path from "path";
import { tabletojson } from "tabletojson";
import { fileURLToPath } from "url";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";

const BASE_URL = "https://onlinemusicsongcontest.miraheze.org/wiki/";
const WIKI_PAGES = {
    COUNTRIES_A: "List_of_countries_in_the_Online_Music_Song_Contest_(A-L)",
    COUNTRIES_B: "List_of_countries_in_the_Online_Music_Song_Contest_(M-Z)",
    MEMBERS_A: "List_of_members_in_the_Online_Music_Song_Contest_(A-L)",
    MEMBERS_B: "List_of_members_in_the_Online_Music_Song_Contest_(M-Z)",
};
const VETERAN_PARTICIPATIONS = 50;
const ESTABLISHED_PARTICIPATIONS = 25;
const MEMBERS_MINIMUM_PARTICIPATIONS = 5;

const argv = yargs(hideBin(process.argv))
    .options({
        edition: { type: "number" },
    })
    .parseSync();

fs.mkdirSync("./dist", { recursive: true });

/**
 * Fetch content from multiple URLs.
 * @param urls URLs to fetch content from.
 * @returns Promise containing the fetched content.
 */
async function fetchContent(urls: string[]) {
    try {
        return await Promise.all(
            urls.map(async (url) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch ${url}`);
                return response.text();
            }),
        );
    } catch (error) {
        console.error("Error fetching URLs:", error);
        throw error;
    }
}

/**
 * Extract data from web sources using Cheerio.
 * @param websources Web sources to extract data from.
 * @returns Extracted data.
 */
function extractData(websources: string[]) {
    return websources.map((websource) => {
        const $ = cheerio.load(websource);
        const extracted: [string, string][] = [];

        // Gets the countries based on classes `thumbborder` and `new`
        // (`new` is for images that do not exist yet on the page)
        $("p:contains('• ') > span").each((_, element) => {
            const parentText = $(element).parent().text();
            const flagName = decodeURIComponent(
                $(element)
                    .find("img")
                    .attr("src")
                    ?.match(/\/Flag(.+?)\//)?.[1]
                    ?.replace(".png", "")
                    .replace(/_/g, " ") ?? "",
            );

            const entry = parentText.replace("•  ", "").replace(/\n/g, "").trim();
            extracted.push([entry, flagName]);
        });

        // Remove duplicates
        const uniqueExtracted = extracted.filter(
            (value, index, self) => index === self.findIndex((t) => t[0] === value[0] && t[1] === value[1]),
        );

        // Sort by name
        uniqueExtracted.sort((a, b) => {
            const aName = a[0].toLowerCase();
            const bName = b[0].toLowerCase();

            if (aName.normalize("NFD").match(/[\u0300-\u036f]/g) || bName.normalize("NFD").match(/[\u0300-\u036f]/g)) {
                return 0; // Keep original order for special characters
            }
            return aName > bName ? 1 : aName < bName ? -1 : 0;
        });

        return uniqueExtracted;
    });
}

// TODO: Remove flag overrides when country-emoji package is updated to v2
// This should fix issues with not getting the correct flag for some countries

/**
 * Read flag overrides from a file.
 * @param filePath Path to the file.
 * @returns Flag overrides.
 */
function readFlagOverrides(filePath: string) {
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data) as Record<string, string>;
    }
    return {};
}

const flagOverridesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "flagOverrides.json");
const flagOverrides = readFlagOverrides(flagOverridesPath);

/**
 * Get flag for a country.
 * @param name Country name.
 * @returns Flag emoji.
 */
function getFlag(name: string) {
    return flagOverrides[name] ?? flag(name) ?? "❓";
}

type CountriesMapValue = [number];
type MembersMapValue = [number, string];

/**
 * Format data for output.
 * @param map Map to format.
 * @param isMembersArray Whether the map is for members.
 * @returns Formatted message.
 */
function formatMessage(map: Map<string, CountriesMapValue | MembersMapValue>, isMembersArray = false) {
    let formattedMessage = "";
    let rank = 1;
    let previousPoints = 0;
    let tieCount = 0;

    map.forEach((value, name) => {
        const emoji = getFlag(isMembersArray ? (value[1] ?? "") : name);
        const points = value[0];

        const nextIndex = Array.from(map.keys()).indexOf(name) + 1;
        const nextCountry = Array.from(map.keys())[nextIndex];
        const nextPoints = nextCountry ? map.get(nextCountry) : undefined;
        const pointsEqual = nextPoints?.[0] === points || previousPoints === points;
        const isPodium = rank <= 3 && !pointsEqual;

        if (rank === 1 && !pointsEqual) {
            formattedMessage += "🥇 ";
        } else if (rank === 2 && !pointsEqual) {
            formattedMessage += "🥈 ";
        } else if (rank === 3 && !pointsEqual) {
            formattedMessage += "🥉 ";
        } else if (rank > 3 || pointsEqual) {
            formattedMessage += `${pointsEqual ? `${String(rank - tieCount)}\\` : rank.toString()}. `;
        }

        if (pointsEqual) formattedMessage += "(=) ";
        if (isPodium) formattedMessage += "**";

        formattedMessage += `${emoji} ${name} `;

        formattedMessage += `- ${points.toString()} `;

        if (!isMembersArray) formattedMessage += "points";

        if (isPodium) formattedMessage += "**";
        formattedMessage += "\n";

        tieCount += pointsEqual ? 1 : 0;
        tieCount = nextPoints?.[0] === points ? tieCount : 0;
        previousPoints = points;
        rank++;
    });

    return formattedMessage;
}

/**
 * Extracts edition number from a string.
 * @param edition Edition string.
 * @returns Edition number.
 */
function extractEditionNumber(edition: string) {
    const match = /\d+/.exec(edition);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Process and format the last participation data for all countries.
 * @param countries List of countries from the extracted data.
 * @param tablesCountries Parsed table data containing edition information.
 * @returns Formatted plain text output, sorted alphabetically by country name.
 */
function processLastParticipation(
    countries: [string, string][],
    tablesCountries: Record<TableCountriesHeadings, string>[][],
) {
    const lastParticipation = new Map<string, number>();
    let edition = argv.edition ?? 0;

    // Determine the current edition based on the highest edition number in the data
    if (!argv.edition) {
        tablesCountries.forEach((array) => {
            array.forEach((column) => {
                const editionNumber = extractEditionNumber(column.Edition);
                if (editionNumber && editionNumber > edition) {
                    edition = editionNumber;
                }
            });
        });
    }

    countries.forEach(([country]) => {
        let lastEdition = 0;

        tablesCountries.forEach((array) => {
            array.forEach((column) => {
                const editionNumber = extractEditionNumber(column.Edition);
                const index = tablesCountries.indexOf(array);
                const selectedCountry = countries[index]?.[0] ?? "Unknown";
                // Only consider editions up to the current edition
                if (
                    editionNumber &&
                    editionNumber <= edition &&
                    selectedCountry === country &&
                    editionNumber > lastEdition
                ) {
                    lastEdition = editionNumber;
                }
            });
        });

        lastParticipation.set(country, lastEdition);
    });

    return formatParticipationData(lastParticipation, edition);
}

/**
 * Format country participation data for output.
 * @param lastParticipation Map of countries to their last participation edition.
 * @param edition The current edition number.
 * @returns Formatted plain text output, sorted by most editions missed.
 */
function formatParticipationData(lastParticipation: Map<string, number>, edition: number) {
    let formattedMessage = "";

    // Sort the map entries by editions missed (in descending order)
    const sortedEntries = [...lastParticipation.entries()].sort((a, b) => {
        const missedA = edition - a[1];
        const missedB = edition - b[1];
        return missedB - missedA;
    });

    sortedEntries.forEach(([country, lastEdition]) => {
        const editionsMissed = edition - lastEdition;
        const emoji = getFlag(country);
        const isCurrent = edition === lastEdition;
        formattedMessage += `${emoji} ${isCurrent ? "**" : ""}${country} ${lastEdition.toString()} ${editionsMissed !== 0 ? `(+${editionsMissed.toString()})` : ""}${isCurrent ? "**" : ""}\n`;
    });

    return formattedMessage;
}

type TableCountriesHeadings = "Edition" | "Artist(s)" | "Song" | "Language" | "Place" | "Points";
type TableMembersHeadings =
    | "Edition"
    | "Country"
    | "Artist(s)"
    | "Song"
    | "Language"
    | "GF Place"
    | "GF Points"
    | "SF Place"
    | "SF Points";

/**
 * Process and save results.
 */
async function processResults() {
    const urls = [
        BASE_URL + WIKI_PAGES.COUNTRIES_A,
        BASE_URL + WIKI_PAGES.COUNTRIES_B,
        BASE_URL + WIKI_PAGES.MEMBERS_A,
        BASE_URL + WIKI_PAGES.MEMBERS_B,
    ];

    const webSources = await fetchContent(urls);
    const [countriesA = [], countriesB = [], membersA = [], membersB = []] = extractData(webSources);

    const countries = [...countriesA, ...countriesB];
    const members = [...membersA, ...membersB];

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    const tablesCountries: Record<TableCountriesHeadings, string>[][] = [
        ...(await tabletojson.convertUrl(BASE_URL + WIKI_PAGES.COUNTRIES_A)),
        ...(await tabletojson.convertUrl(BASE_URL + WIKI_PAGES.COUNTRIES_B)),
    ];

    const tablesMembers: Record<TableMembersHeadings, string>[][] = [
        ...(await tabletojson.convertUrl(BASE_URL + WIKI_PAGES.MEMBERS_A)),
        ...(await tabletojson.convertUrl(BASE_URL + WIKI_PAGES.MEMBERS_B)),
    ];
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    let totalStats = new Map<string, CountriesMapValue>(); // [totalPoints]
    let averageStats = new Map<string, CountriesMapValue>(); // [averagePoints]
    let averagePlaces = new Map<string, MembersMapValue>(); // [averagePlace, flagName]

    // Process country stats
    tablesCountries.forEach((array) => {
        const filteredArray = array.filter((column) => {
            const editionNumber = extractEditionNumber(column.Edition);
            return (
                editionNumber !== null &&
                editionNumber <= (argv.edition ?? Infinity) &&
                !column.Points.match(/[^0-9.]/g) &&
                parseInt(column.Points)
            );
        });

        let totalPoints = 0;
        let averagePoints = 0;

        filteredArray.forEach((column) => {
            const points = parseInt(column.Points);
            totalPoints += points;
        });

        averagePoints = Math.round((totalPoints / filteredArray.length) * 10) / 10;

        const index = tablesCountries.indexOf(array);
        const country = countries[index]?.[0] ?? "Unknown";

        if (totalPoints !== 0) {
            totalStats.set(country, [totalPoints]);
            averageStats.set(country, [averagePoints]);
        }
    });

    // Process member stats
    tablesMembers.forEach((array) => {
        const filteredArray = array.filter((column) => {
            const editionNumber = extractEditionNumber(column.Edition);
            return (
                editionNumber !== null &&
                editionNumber <= (argv.edition ?? Infinity) &&
                (column["GF Points"] || column["SF Points"])
            );
        });

        let totalPlace = 0;
        let count = 0;
        let averagePlace = 0;

        filteredArray.forEach((column) => {
            const place = parseInt(column["GF Place"]);
            if (place) {
                totalPlace += place;
                count++;
            }
        });

        averagePlace = Math.round((totalPlace / count) * 10) / 10;

        const index = tablesMembers.indexOf(array);
        const member = members[index]?.[0] ?? "Unknown";
        const flagName = members[index]?.[1] ?? "Unknown";

        const countTotal = array.length;

        // Get new veterans and established members
        if (countTotal === VETERAN_PARTICIPATIONS) console.log("\x1b[36mVeteran:\x1b[0m", countTotal, `[${member}]`);
        else if (countTotal === ESTABLISHED_PARTICIPATIONS) console.log("\x1b[32mEstablished:\x1b[0m", countTotal, `[${member}]`);

        if (totalPlace !== 0 && count >= MEMBERS_MINIMUM_PARTICIPATIONS) {
            averagePlaces.set(member, [averagePlace, flagName]);
        }
    });

    // Sort maps
    totalStats = new Map([...totalStats.entries()].sort((a, b) => b[1][0] - a[1][0]));
    averageStats = new Map([...averageStats.entries()].sort((a, b) => b[1][0] - a[1][0]));
    averagePlaces = new Map([...averagePlaces.entries()].sort((a, b) => a[1][0] - b[1][0]));

    // Save results
    fs.writeFileSync("./dist/all-time-results.txt", formatMessage(totalStats));
    fs.writeFileSync("./dist/average-scores-final.txt", formatMessage(averageStats));
    fs.writeFileSync("./dist/average-scores-members.txt", formatMessage(averagePlaces, true));
    fs.writeFileSync("./dist/last-countries-participations.txt", processLastParticipation(countries, tablesCountries));
}

processResults().catch((error: unknown) => {
    console.error("Error processing results:", error);
});
