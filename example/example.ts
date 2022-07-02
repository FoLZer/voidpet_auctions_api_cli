import { Api, Subscription, Filter, FilterType, SubscriptionType } from "../src";

/*
	Fields: [
		id: String, <- Auction Id
		buyout_price: i32 | null,
		current_bid_price: i32 | null,
		quantity: i32,
		time_left: String,
		item_id: i32
	]
*/

async function main() {
	const api = new Api("ws://127.0.0.1/ws");
	await api.openConnection();
	const filter = new Filter(FilterType.AND, null, [
		new Filter(FilterType.EQ, null, [
			new Filter(FilterType.FIELD, ["item_id"], null),
			new Filter(FilterType.STRING, ["147", "148", "149", "146", "150", "162", "276"], null) //Works as OR (only in EQ FilterType)
		]),
		new Filter(FilterType.OR, null, [
			new Filter(FilterType.LESS, null, [
				new Filter(FilterType.FIELD, ["current_bid_price"], null),
				new Filter(FilterType.I32, ["50"], null)
			]),
			new Filter(FilterType.LESS, null, [
				new Filter(FilterType.FIELD, ["buyout_price"], null),
				new Filter(FilterType.I32, ["100"], null)
			])
		])
	])
	const subs = new Subscription(SubscriptionType.NewAuctions, filter);
	await api.updateSubscriptions([subs]);
	api.on("AuctionsUpdates", (p) => {
		console.log(p);
	})
	api.on("NewAuctions", (p) => {
		console.log(p);
	})
}
main();