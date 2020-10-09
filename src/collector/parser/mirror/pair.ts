import { findAttributes, findAttribute } from 'lib/terra'
import { splitTokenAmount } from 'lib/utils'
import { num } from 'lib/num'
import { assetService, accountService, priceService, statisticService } from 'services'
import { TxEntity, AssetPositionsEntity, DailyStatisticEntity, PriceEntity, BalanceEntity } from 'orm'
import { TxType } from 'types'
import { ParseArgs } from './parseArgs'

export async function parse(
  { manager, height, txHash, timestamp, sender, msg, log, contract }: ParseArgs
): Promise<void> {
  const { token, govId } = contract
  const datetime = new Date(timestamp)
  const attributes = findAttributes(log.events, 'from_contract')
  const positionsRepo = manager.getRepository(AssetPositionsEntity)
  const balanceRepo = manager.getRepository(BalanceEntity)
  let parsed = {}
  let positions: AssetPositionsEntity

  if (msg['swap']) {
    const offerAsset = findAttribute(attributes, 'offer_asset')
    const askAsset = findAttribute(attributes, 'ask_asset')
    const offerAmount = findAttribute(attributes, 'offer_amount')
    const returnAmount = findAttribute(attributes, 'return_amount')
    const taxAmount = findAttribute(attributes, 'tax_amount')
    const spreadAmount = findAttribute(attributes, 'spread_amount')
    const lpCommissionAmount = findAttribute(attributes, 'lp_commission_amount')
    const ownerCommissionAmount = findAttribute(attributes, 'owner_commission_amount')
    const commissionAmount = num(lpCommissionAmount).plus(ownerCommissionAmount).toString()

    const type = offerAsset === 'uusd' ? TxType.BUY : TxType.SELL

    const volume = type === TxType.BUY
      ? offerAmount
      : num(returnAmount).plus(spreadAmount).plus(commissionAmount).toString()

    // buy price: offer / (return + commission)
    // sell price: (return + commission) / offer
    const price = type === TxType.BUY
      ? num(offerAmount).dividedBy(num(returnAmount).plus(commissionAmount)).toString()
      : num(returnAmount).plus(commissionAmount).dividedBy(offerAmount).toString()

    // buy fee: pool price * commission
    const feeValue = type === TxType.BUY
      ? num(offerAmount)
          .dividedBy(num(returnAmount).plus(spreadAmount).plus(commissionAmount))
          .multipliedBy(commissionAmount).toString()
      : commissionAmount

    const recvAmount = num(returnAmount).minus(taxAmount).toString()
    const poolChanged = num(returnAmount).plus(ownerCommissionAmount).multipliedBy(-1).toString()

    // add asset's pool position, account balance
    if (type === TxType.BUY) {
      positions = await assetService().addPoolPosition(token, poolChanged, offerAmount, positionsRepo)
      await accountService().addBalance(sender, token, price, recvAmount, balanceRepo)
    } else {
      positions = await assetService().addPoolPosition(token, offerAmount, poolChanged, positionsRepo)
      await accountService().removeBalance(sender, token, offerAmount, balanceRepo)
    }

    // add daily trading volume
    const dailyStatRepo = manager.getRepository(DailyStatisticEntity)
    await statisticService().addDailyTradingVolume(datetime.getTime(), volume, dailyStatRepo)

    parsed = {
      type,
      data: {
        offerAsset,
        askAsset,
        offerAmount,
        returnAmount,
        taxAmount,
        spreadAmount,
        commissionAmount,
        lpCommissionAmount,
        ownerCommissionAmount,
        recvAmount,
        price,
      },
      feeValue,
      volume
    }
  } else if (msg['provide_liquidity']) {
    const assets = findAttribute(attributes, 'assets')
    const liquidities = assets.split(', ').map((assetAmount) => splitTokenAmount(assetAmount))
    const assetToken = liquidities[0]
    const uusdToken = liquidities[1]

    parsed = {
      type: TxType.PROVIDE_LIQUIDITY,
      data: { assets, share: findAttribute(attributes, 'share') }
    }

    // remove account balance
    await accountService().removeBalance(sender, token, assetToken.amount, balanceRepo)

    // add asset's liquidity position
    positions = await assetService().addLiquidityPosition(
      assetToken.token, assetToken.amount, uusdToken.amount, positionsRepo
    )
  } else if (msg['withdraw_liquidity']) {
    const refundAssets = findAttribute(attributes, 'refund_assets')
    const liquidities = refundAssets.split(', ').map((assetAmount) => splitTokenAmount(assetAmount))
    const assetToken = liquidities[1]
    const uusdToken = liquidities[0]

    parsed = {
      type: TxType.WITHDRAW_LIQUIDITY,
      data: { refundAssets, withdrawnShare: findAttribute(attributes, 'withdrawn_share') }
    }

    // add account balance
    const price = await priceService().getPrice(token, datetime.getTime(), manager.getRepository(PriceEntity))
    await accountService().addBalance(sender, token, price, assetToken.amount, balanceRepo)

    // remove asset's liquidity position
    positions = await assetService().addLiquidityPosition(
      assetToken.token, `-${assetToken.amount}`, `-${uusdToken.amount}`, positionsRepo
    )
  } else {
    return
  }

  // set pool price ohlc
  const tx = new TxEntity({
    ...parsed, height, txHash, address: sender, datetime, govId, token, contract
  })

  const price = await priceService().setOHLC(
    token,
    datetime.getTime(),
    num(positions.uusdPool).dividedBy(positions.pool).toString(),
    manager.getRepository(PriceEntity),
    false
  )

  await manager.save([tx, price])
}
