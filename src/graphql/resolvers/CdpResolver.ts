import { In, MoreThan, Raw } from 'typeorm'
import { Resolver, Query, Arg } from 'type-graphql'
import { Service } from 'typedi'
import { Cdp } from 'graphql/schema'
import { CdpService } from 'services'

@Service()
@Resolver((of) => Cdp)
export class CdpResolver {
  constructor(private readonly cdpService: CdpService) {}

  @Query((returns) => [Cdp], { description: 'Get cdps' })
  async cdps(
    @Arg('maxRatio') maxRatio: number,
    @Arg('tokens', (type) => [String], { nullable: true }) tokens?: string[],
    @Arg('address', (type) => [String], { nullable: true }) address?: string[],
  ): Promise<Cdp[]> {
    const addressCondition = address ? { address: In(address) } : {}
    const tokensCondition = tokens ? { token: In(tokens) } : {}
    if (Array.isArray(address) && address.length > 50) {
      throw new Error('too many addresses')
    }
    if (Array.isArray(tokens) && tokens.length > 50) {
      throw new Error('too many tokens')
    }

    return this.cdpService.getAll({
      where: {
        collateralRatio: Raw((alias) => `${alias} < ${maxRatio}`),
        mintAmount: MoreThan(0),
        ...addressCondition,
        ...tokensCondition,
      },
      order: { collateralRatio: 'ASC' },
      take: 100
    })
  }

  @Query((returns) => [Cdp], { description: 'Get liquidation target cdps' })
  async liquidations(): Promise<Cdp[]> {
    return this.cdpService.getAll({
      where: { collateralRatio: Raw((alias) => `${alias} < min_collateral_ratio`) },
      order: { mintValue: 'DESC' },
      take: 100
    })
  }
}
