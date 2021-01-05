import { Resolver, Query, FieldResolver, Root, Arg } from 'type-graphql'
import { Statistic, TodayStatistic, ValueAt, AccountBalance } from 'graphql/schema'
import { StatisticService } from 'services'

@Resolver((of) => Statistic)
export class StatisticResolver {
  constructor(private readonly statisticService: StatisticService) {}

  @Query((returns) => Statistic)
  async statistic(@Arg('network', { defaultValue: "COMBINE" }) network: string): Promise<Statistic> {
    return await this.statisticService.statistic(network) as Statistic
  }

  @Query((returns) => [AccountBalance])
  async richlist(
    @Arg('token') token: string,
    @Arg('offset', { defaultValue: 0 }) offset: number,
    @Arg('limit', { defaultValue: 1000 }) limit: number,
  ): Promise<AccountBalance[]> {
    if (limit > 10000) {
      throw new Error('limit is too high')
    }
    return this.statisticService.richlist(token, offset, limit)
  }

  @FieldResolver((type) => TodayStatistic)
  async today(@Root() statistic: Statistic): Promise<TodayStatistic> {
    return this.statisticService.today(statistic.network)
  }

  @FieldResolver((type) => String)
  async govAPR(@Root() statistic: Statistic): Promise<string> {
    return this.statisticService.getGovAPR()
  }

  @FieldResolver((type) => [ValueAt])
  async liquidityHistory(
    @Root() statistic: Statistic,
    @Arg('from', { description: 'timestamp' }) from: number,
    @Arg('to', { description: 'timestamp' }) to: number
  ): Promise<ValueAt[]> {
    return this.statisticService.getLiquidityHistory(statistic.network, from, to)
  }

  @FieldResolver((type) => [ValueAt])
  async tradingVolumeHistory(
    @Root() statistic: Statistic,
    @Arg('from', { description: 'timestamp' }) from: number,
    @Arg('to', { description: 'timestamp' }) to: number
  ): Promise<ValueAt[]> {
    return this.statisticService.getTradingVolumeHistory(statistic.network, from, to)
  }
}
