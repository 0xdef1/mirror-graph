import { TxInfo, TxLog, MsgExecuteContract } from '@terra-money/terra.js'
import { MirrorParser } from './MirrorParser'
import { TxEntity, ContractEntity } from 'orm'
import { TxType } from 'types'

export class MarketParser extends MirrorParser {
  async parse(
    txInfo: TxInfo,
    msg: MsgExecuteContract,
    log: TxLog,
    contract: ContractEntity
  ): Promise<unknown[]> {
    if (msg.execute_msg['buy']) {
      return this.parseBuy(txInfo, msg, log, contract)
    }

    return []
  }

  private async parseBuy(
    txInfo: TxInfo,
    msg: MsgExecuteContract,
    log: TxLog,
    contract: ContractEntity
  ): Promise<unknown[]> {
    const tx = new TxEntity({
      txHash: txInfo.txhash,
      type: TxType.BUY,
      symbol: contract.asset.symbol,
      data: {
        offer: log.events[1].attributes[2].value,
        receive: log.events[1].attributes[3].value,
        spread: log.events[1].attributes[4].value,
        fee: log.events[1].attributes[5].value,
      },
      datetime: new Date(txInfo.timestamp),
      gov: contract.gov,
    })

    const price = await this.priceService.setOHLC(
      contract.asset,
      new Date(txInfo.timestamp).getTime(),
      await this.assetService.getPrice(contract.asset)
    )

    return [tx, price]
  }
}
