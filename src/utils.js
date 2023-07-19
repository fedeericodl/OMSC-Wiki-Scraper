const { fetch } = require("undici");

module.exports = {
	async request() {
		const responses = [];

		for (let i = 0; i < arguments.length; i++) {
			const url = arguments[i];
			let response = null;
			try {
				// eslint-disable-next-line no-await-in-loop
				response = await fetch(url).then((res) => res.text());
			} catch (error) {
				console.error("Request failed", error);
				continue;
			}
			responses.push(response);
		}

		return responses;
	}
};
