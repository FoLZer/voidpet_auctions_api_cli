import WebSocket from 'ws';
import { EventEmitter } from "events";
import { BitSet } from "bitset";

export class Filter {
	type: FilterType
	data: String[] | null
	filters: Filter[] | null

	constructor(type: FilterType, data: String[] | null, filters: Filter[] | null) {
		this.type = type;
		this.data = data;
		this.filters = filters;
	}

	toBytes() {
		let b = Buffer.allocUnsafe(1);
		b[0] = this.type;
		if(this.data) {
			let b1 = Buffer.allocUnsafe(1);
			b1[0] = this.data.length;
			let b2 = [];
			for(const s of this.data) {
				const buf = Buffer.from(s, "ascii");
				b2.push(buf, Buffer.alloc(1));
			}
			b = Buffer.concat([b, b1, ...b2])
		} else {
			let b1 = Buffer.alloc(1);
			b = Buffer.concat([b, b1]);
		}
		if(this.filters) {
			let b1 = Buffer.allocUnsafe(1);
			b1[0] = this.filters.length;
			let b2 = [];
			for(const f of this.filters) {
				const buf = f.toBytes();
				b2.push(buf);
			}
			b = Buffer.concat([b, b1, ...b2])
		} else {
			let b1 = Buffer.alloc(1);
			b = Buffer.concat([b, b1]);
		}
		return b;
	}
}

export enum FilterType {
	NOT,
    AND,
    OR,
    XOR,

    EQ,
    LESS,
    MORE,

    FIELD,
    STRING,
    I32
}

export enum SubscriptionType {
	NewAuctions = 0,
	AuctionsUpdates = 1
}

export class Subscription {
	type: SubscriptionType
	filter: Filter

	constructor(type: SubscriptionType, filter: Filter) {
		this.type = type;
		this.filter = filter;
	}

	toBytes() {
		const b1 = this.filter.toBytes();
		const b = new Uint8Array(b1.length+1);
		b[0] = this.type;
		for(let i=1;i<=b1.length;i++) {
			b[i] = b1[i-1];
		}
		return b;
	}
}

export class Auction {
	id: String
	buyout_price: Number | null
	current_bid_price: Number | null
	quantity: Number
	time_left: String
	item_id: Number

	private constructor(id: String, buyout_price: Number | null, current_bid_price: Number | null, quantity: Number, time_left: String, item_id: Number) {
		this.id = id;
		this.buyout_price = buyout_price;
		this.current_bid_price = current_bid_price;
		this.quantity = quantity
		this.time_left = time_left;
		this.item_id = item_id;
	}

	static fromBuffer(buf: Buffer) {
		let cursor = 0;

		let id = "";
		{
			const len = buf.readUint8(cursor);
			cursor++;
			id = buf.toString("ascii", cursor, cursor+len);
			cursor += len;
		}
		let buyout_price: Number | null = buf.readInt32BE(cursor);
		if(buyout_price == -1) {
			buyout_price = null;
		}
		cursor += 4;
		let current_bid_price: Number | null = buf.readInt32BE(cursor);
		if(current_bid_price == -1) {
			current_bid_price = null;
		}
		cursor += 4;
		let quantity = buf.readInt32BE(cursor);
		cursor += 4;
		let time_left = ""
		{
			const len = buf.readUint8(cursor);
			cursor++;
			time_left = buf.toString("ascii", cursor, cursor+len);
			cursor += len;
		}
		let item_id = buf.readInt32BE(cursor);
		cursor += 4;
		return {
			auc: new Auction(id, buyout_price, current_bid_price, quantity, time_left, item_id),
			bytes_read: cursor
		};
	}
}

type EventMap = Record<string, any>;

type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

interface IEmitter<T extends EventMap> {
  on<K extends EventKey<T>>
    (eventName: K, fn: EventReceiver<T[K]>): void;
  off<K extends EventKey<T>>
    (eventName: K, fn: EventReceiver<T[K]>): void;
  emit<K extends EventKey<T>>
    (eventName: K, params: T[K]): void;
}

class Emitter<T extends EventMap> implements IEmitter<T> {
	private emitter = new EventEmitter();
	on<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>) {
	  this.emitter.on(eventName, fn);
	}
  
	off<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>) {
	  this.emitter.off(eventName, fn);
	}
  
	emit<K extends EventKey<T>>(eventName: K, params: T[K]) {
	  this.emitter.emit(eventName, params);
	}
}


export class Api extends Emitter<{"NewAuctions": Auction[], "AuctionsUpdates": Auction[]}> {
	private url: string;
	private ws?: WebSocket;

	constructor(url: string) {
		super();
		this.url = url;
	}

	public async openConnection(): Promise<void> {
		const ws = new WebSocket(this.url);
		
		return new Promise(resolve => {
			ws.on("open", () => {
				this.ws = ws;
				resolve();
			});
			ws.on("message", (data, isBinary) => {
				if(!isBinary) {
					throw new Error(data.toString("utf-8"));
				}
				if(!Buffer.isBuffer(data)) {
					throw new Error("Data wasn't a buffer");
				}
				let sub_type = data.readUInt8(0);
				let v_len = data.readBigUint64BE(1);
				let ar = [];
				let cursor = 9;
				for(let i=0;i<v_len;i++) {
					let r = Auction.fromBuffer(data.subarray(cursor));
					cursor += r.bytes_read;
					ar.push(r.auc);
				}
				this.emit(SubscriptionType[sub_type] as any, ar);
			})
		})
	}
	public async updateSubscriptions(subs: Subscription[]): Promise<void> {
		return new Promise((resolve, reject) => {
			if(!this.ws) {
				return reject("Tried to update before opening the connection");
			}
			let b1 = new BitSet(0);
			for(const sub of subs) {
				if(b1.get(sub.type)) {
					return reject("Tried to send multiple subscriptions with same types");
				}
				b1.set(sub.type, 1);
			}
			let b = Buffer.allocUnsafe(1);
			b[0] = Number(b1.toString(10));
			for(const sub of subs.sort((a, b) => a.type - b.type)) {
				const bytes = sub.toBytes();
				b = Buffer.concat([b, bytes]);
			}
			this.ws.send(b, (err) => {
				if(err) {
					return reject(err);
				}
				resolve();
			})
		})
	}
}