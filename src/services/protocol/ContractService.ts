import { Repository, FindConditions } from 'typeorm'
import { InjectRepository } from 'typeorm-typedi-extensions'
import { Service } from 'typedi'
import initMsgs from 'contracts/initMsgs'
import { TxWallet } from 'lib/terra'
import { ContractEntity, GovEntity } from 'orm'
import { ContractType } from 'types'

@Service()
export class ContractService {
  constructor(
    @InjectRepository(ContractEntity) private readonly contractRepo: Repository<ContractEntity>
  ) {}

  async get(conditions: FindConditions<ContractEntity>): Promise<ContractEntity> {
    return this.contractRepo.findOne(conditions)
  }

  async create(
    wallet: TxWallet,
    gov: GovEntity,
    type: ContractType,
    codeId: number,
    initMsg: object
  ): Promise<ContractEntity> {
    const address = await wallet.instantiate(codeId, initMsg)
    // return Object.assign(new ContractEntity(), { address, type, gov })
    return this.contractRepo.save({ address, type, gov })
  }

  async createFactory(wallet: TxWallet, gov: GovEntity): Promise<ContractEntity> {
    return this.create(wallet, gov, ContractType.FACTORY, gov.codeIds.factory, initMsgs.factory)
  }

  async createGov(wallet: TxWallet, gov: GovEntity): Promise<ContractEntity> {
    return this.create(wallet, gov, ContractType.GOV, gov.codeIds.gov, {
      ...initMsgs.gov,
      mirrorToken: gov.mirrorToken.address,
    })
  }

  async createCollector(wallet: TxWallet, gov: GovEntity): Promise<ContractEntity> {
    return this.create(wallet, gov, ContractType.COLLECTOR, gov.codeIds.collector, {
      ...initMsgs.collector,
      govContract: gov.gov.address,
      factoryContract: gov.factory.address,
      mirrorToken: gov.mirrorToken.address,
    })
  }

  async createMint(wallet: TxWallet, gov: GovEntity): Promise<ContractEntity> {
    return this.create(wallet, gov, ContractType.MINT, gov.codeIds.mint, initMsgs.mint)
  }

  async createOracle(
    wallet: TxWallet,
    gov: GovEntity,
    token: ContractEntity,
    baseDenom: string,
    quoteDenom: string
  ): Promise<ContractEntity> {
    return this.create(wallet, gov, ContractType.ORACLE, gov.codeIds.oracle, {
      assetToken: token.address,
      baseDenom,
      quoteDenom,
    })
  }

  async createToken(
    wallet: TxWallet,
    gov: GovEntity,
    symbol: string,
    name: string,
    minter: ContractEntity
  ): Promise<ContractEntity> {
    const initMsg = {
      ...initMsgs.token,
      symbol,
      name,
      mint: { cap: '100000000000', minter: minter.address },
    }
    return this.create(wallet, gov, ContractType.TOKEN, gov.codeIds.token, initMsg)
  }

  async createMarket(
    wallet: TxWallet,
    gov: GovEntity,
    symbol: string,
    token: ContractEntity,
    oracle?: ContractEntity
  ): Promise<{ market: ContractEntity; lpToken: ContractEntity; staking: ContractEntity }> {
    const market = await this.create(wallet, gov, ContractType.MARKET, gov.codeIds.market, {
      ...initMsgs.market,
      commissionCollector: gov.collector.address,
      assetSymbol: symbol,
      assetToken: token.address,
      assetOracle: oracle?.address,
    })

    const lpToken = await this.create(wallet, gov, ContractType.LPTOKEN, gov.codeIds.token, {
      ...initMsgs.token,
      symbol: `${symbol}-LP`,
      name: `${symbol}-UST LP`,
      mint: { cap: '100000000000', minter: market.address },
    })

    const staking = await this.create(wallet, gov, ContractType.STAKING, gov.codeIds.staking, {
      mirrorToken: gov.mirrorToken.address,
      stakingToken: lpToken.address,
    })

    // set liquidity token to market
    await wallet.execute(market.address, { PostInitialize: { liquidityToken: lpToken.address } })

    return { market, lpToken, staking }
  }
}