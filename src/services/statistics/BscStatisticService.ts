import * as bluebird from 'bluebird'
import memoize from 'memoizee-decorator'
import { Container, Service, Inject } from 'typedi'
import { find, sortedUniq } from 'lodash'
import { ethers } from 'ethers'
import { num } from 'lib/num'
import { getPairHourDatas, getPairDayDatas, getPairsDayDatas, totalSupply } from 'lib/bsc'
import { AssetService, BscService } from 'services'
import { PeriodStatistic, ValueAt } from 'graphql/schema'
import { AssetStatus } from 'types'

const FEE_RATE = 0.002

@Service()
export class BscStatisticService {
  constructor(
    @Inject((type) => AssetService) private readonly assetService: AssetService,
    @Inject((type) => BscService) private readonly bscService: BscService,
  ) {}

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async totalValueLocked(): Promise<string> {
    const assets = this.bscService.getAssets()
    let totalValueLocked = num(0)

    await bluebird.map(Object.keys(assets), async (token) => {
      const { pair } = assets[token]
      const liquidity = await this.getAssetLiquidity(pair)

      totalValueLocked = totalValueLocked.plus(liquidity)
    })

    return totalValueLocked.toFixed(0)
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async assetMarketCap(): Promise<string> {
    const assets = this.bscService.getAssets()
    let assetMarketCap = num(0)

    await bluebird.map(Object.keys(assets).filter((token) => assets[token]?.symbol !== 'MIR'), async (token) => {
      const { pair } = assets[token]
      const datas = await getPairDayDatas(pair, 0, Date.now(), 1, 'desc')
      if (!datas || datas.length < 1) {
        return
      }
      const pairData = datas[0]
      const price = num(pairData.reserve1).dividedBy(pairData.reserve0)
      const supply = num(ethers.utils.formatEther(await totalSupply(token))).multipliedBy(1000000)

      assetMarketCap = assetMarketCap.plus(supply.multipliedBy(price))
    })

    return assetMarketCap.toFixed(0)
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async today(): Promise<PeriodStatistic> {
    // start of today (UTC)
    const from = Date.now() - (Date.now() % 86400000)

    const assets = this.bscService.getAssets()
    const pairAddresses = Object.keys(assets).map((token) => assets[token].pair)
    const datas = await getPairsDayDatas(pairAddresses, from, from)
    const transactions = datas.reduce((result, data) => result.plus(data.dailyTxns), num(0)).toString()
    const volume = datas.reduce((result, data) => result.plus(data.dailyVolumeToken1), num(0)).multipliedBy(1000000).toFixed(0)
    const feeVolume = num(volume).multipliedBy(FEE_RATE).toFixed(0)
    const mirPair = find(assets, (asset) => asset.symbol === 'MIR')?.pair.toLowerCase()
    const mirVolume = mirPair
      ? num(find(datas, (data) => data.pairAddress === mirPair)?.dailyVolumeToken1 || '0').multipliedBy(1000000).toFixed(0)
      : '0'

    return {
      transactions,
      volume,
      feeVolume,
      mirVolume,
      activeUsers: '0'
    }
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async latest24h(): Promise<PeriodStatistic> {
    const assets = this.assetService.getAll({ where: { status: AssetStatus.LISTED }})

    let volume = num(0)
    let transactions = num(0)
    let mirVolume = num(0)

    await bluebird.map(assets, async (asset) => {
      const asset24h = await this.getAsset24h(asset.token)

      volume = volume.plus(asset24h.volume)
      transactions = transactions.plus(asset24h.transactions)

      if (asset.symbol === 'MIR') {
        mirVolume = num(asset24h.volume)
      }
    })

    return {
      transactions: transactions.toString(),
      volume: volume.toFixed(0),
      feeVolume: volume.multipliedBy(FEE_RATE).toFixed(0),
      mirVolume: mirVolume.toFixed(0),
      activeUsers: '0'
    }
  }

  @memoize({ promise: true, maxAge: 60000 * 60, preFetch: 0.1 }) // 60 minutes
  async getLiquidityHistory(from: number, to: number): Promise<ValueAt[]> {
    const assets = this.bscService.getAssets()
    const pairAddresses = Object.keys(assets).map((token) => assets[token].pair)
    const initialDatas = await bluebird.map(
      pairAddresses,
      async (pair) => {
        const pairData = await getPairDayDatas(pair, 0, from, 1, 'desc')
        if (pairData[0]) {
          return Object.assign(pairData[0], { timestamp: from })
        }
      }
    ).filter(Boolean)

    let datas = initialDatas
    const maxRange = 86400000 * 4
    for (let queryFrom = from + 86400000; queryFrom <= to; queryFrom += maxRange) {
      datas.push(...await getPairsDayDatas(
        pairAddresses, queryFrom, Math.min(queryFrom + (maxRange - 86400000), to)
      ))
    }
    datas = datas.sort((a, b) => b.timestamp - a.timestamp)

    const history = []
    for (let timestamp = from; timestamp <= to; timestamp += 86400000) {
      history.push({
        timestamp,
        value: pairAddresses.reduce(
          (result, pair) => {
            const pairData = datas.find((data) => data.pairAddress === pair.toLowerCase() && data.timestamp <= timestamp)
            const liquidity = pairData
              ? num(pairData.reserve1).dividedBy(pairData.reserve0).multipliedBy(pairData.reserve0).plus(pairData.reserve1)
              : num(0)

            return result.plus(liquidity)
          },
          num(0)
        ).multipliedBy(1000000).toFixed(0)
      })
    }

    return history.filter((data) => data.value !== '0')
  }

  @memoize({ promise: true, maxAge: 60000 * 30, preFetch: 0.2 }) // 30 minutes
  async getTradingVolumeHistory(from: number, to: number): Promise<ValueAt[]> {
    const assets = this.bscService.getAssets()
    const pairAddresses = Object.keys(assets).map((token) => assets[token].pair)

    const history = []
    const maxRange = 86400000 * 4
    for (let queryFrom = from; queryFrom <= to; queryFrom += maxRange) {
      const datas = await getPairsDayDatas(
        pairAddresses, queryFrom, Math.min(queryFrom + (maxRange - 86400000), to)
      )
      history.push(...sortedUniq(datas.map((data) => data.timestamp)).map((timestamp) => ({
        timestamp,
        value: datas
          .filter((data) => data.timestamp === timestamp)
          .reduce((result, data) => result.plus(data.dailyVolumeToken1), num(0)).multipliedBy(1000000).toFixed(0)
      })))
    }
    return history
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async getAssetDayVolume(token: string, timestamp: number): Promise<string> {
    const ethAsset = await this.bscService.getAsset(token)
    if (!ethAsset) {
      return '0'
    }
    const datas = await getPairDayDatas(ethAsset.pair, timestamp, timestamp, 1, 'desc')
    return datas
      .reduce((result, data) => result.plus(data.dailyVolumeToken1), num(0))
      .multipliedBy(1000000)
      .toFixed(0)
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async getAsset24h(token: string): Promise<{ volume: string; transactions: string }> {
    const asset = await this.bscService.getAsset(token)
    if (!asset) {
      return {
        volume: '0',
        transactions: '0'
      }
    }

    const now = Date.now()
    const to = now - (now % 3600000)
    const from = to - 86400000
    const datas = await getPairHourDatas(asset.pair, from, to, 24, 'asc')

    return {
      volume: datas
        .reduce((result, data) => result.plus(data.hourlyVolumeToken1), num(0))
        .multipliedBy(1000000)
        .toFixed(0),
      transactions: datas
        .reduce((result, data) => result.plus(data.hourlyTxns), num(0))
        .toString()
    }
  }

  @memoize({ promise: true, maxAge: 60000 * 60, preFetch: 0.1 }) // 60 minutes
  async getAssetLiquidity(pair: string): Promise<string> {
    if (!pair) {
      return '0'
    }

    const datas = await getPairDayDatas(pair, 0, Date.now(), 1, 'desc')
    if (!datas || datas.length < 1) {
      return '0'
    }
    const pairData = datas[0]
    return num(pairData.reserve1).dividedBy(pairData.reserve0).multipliedBy(pairData.reserve0)
      .plus(pairData.reserve1)
      .multipliedBy(1000000)
      .toFixed(0)
  }

  @memoize({ promise: true, maxAge: 60000 * 10, preFetch: true }) // 10 minutes
  async getAssetAPR(token: string): Promise<string> {
    const asset = await this.bscService.getAsset(token)
    const assetInfos = await this.bscService.getAssetInfos()

    return assetInfos[asset?.token]?.apr || '0'
  }
}

export function bscStatisticService(): BscStatisticService {
  return Container.get(BscStatisticService)
}
