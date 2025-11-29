import axios from 'axios';

const base_url = 'https://gamma-api.polymarket.com';

export type Params = {
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  id?: number | number[];
  slug?: string | string[];
  archived?: boolean;
  active?: boolean;
  closed?: boolean;
  clob_token_ids?: string | string[];
  condition_ids?: string | string[];
  liquidity_num_min?: number;
  liquidity_num_max?: number;
  volume_num_min?: number;
  volume_num_max?: number;
  start_date_min?: string;
  start_date_max?: string;
  end_date_min?: string;
  end_date_max?: string;
  tag_id?: number;
  related_tags?: boolean;
};

export class GamaAPI {
  db: any;

  constructor(db?: any) {
    this.db = db;
  }

  async get_market(market_id: string) {
    const response = await axios.get(`${base_url}/markets/${market_id}`);
    return response.data;
  }

  async get_markets(params: Params | null = null) {
    const response = await axios.get(`${base_url}/markets`, {
      params: params ? params : undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return response.data;
  }

  async get_last_offset() {
    const last_offset = await this.db.get('last_offset');
    if (!last_offset) {
      return 0;
    }
    return parseInt(last_offset);
  }
  async reset_last_offset(offset: number) {
    await this.db.put('last_offset', offset.toString());
  }

  async scrap_data() {
    if (!this.db) {
      throw new Error('DB is not initialized');
    }
    let offset = await this.get_last_offset();
    let limit = 100; // 每次获取100条数据

    while (true) {
      const params = { limit, offset };
      const markets_data = await this.get_markets(params);

      if (!markets_data) {
        // 如果没有更多数据了
        break;
      }

      console.log(
        `Scraping data from offset: ${offset}, got ${markets_data.length} markets`,
      );
      if (markets_data.length === 0) {
        break;
      }

      for (const market of markets_data) {
        this.db.put(market.id, market);
      }

      if (markets_data.length < limit) {
        limit = markets_data.length;
      }
      offset += limit;
      console.log('offset', offset);
      this.db.put('last_offset', offset.toString()); // 保存当前的offset
    }
  }
}
