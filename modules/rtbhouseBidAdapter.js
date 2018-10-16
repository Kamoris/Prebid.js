import * as utils from 'src/utils';
import { BANNER, NATIVE } from 'src/mediaTypes';
import { registerBidder } from 'src/adapters/bidderFactory';
import includes from 'core-js/library/fn/array/includes';

const BIDDER_CODE = 'rtbhouse';
const REGIONS = ['prebid-eu', 'prebid-us', 'prebid-asia'];
const ENDPOINT_URL = 'creativecdn.com/bidder/prebid/bids';
const DEFAULT_CURRENCY_ARR = ['USD']; // NOTE - USD is the only supported currency right now; Hardcoded for bids

// Codes defined by OpenRTB Native Ads 1.1 specification
export const OPENRTB = {
  NATIVE: {
    IMAGE_TYPE: {
      ICON: 1,
      MAIN: 3,
    },
    ASSET_ID: {
      TITLE: 1,
      IMAGE: 2,
      ICON: 3,
      BODY: 4,
      SPONSORED: 5,
      CLICK_URL: 6,
      CTA: 7
    },
    DATA_ASSET_TYPE: {
      SPONSORED: 1,
      DESC: 2,
      CTA_TEXT: 12,
      CLICK_URL: 501,
    },
  }
};

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, NATIVE],

  isBidRequestValid: function (bid) {
    return !!(includes(REGIONS, bid.params.region) && bid.params.publisherId);
  },
  buildRequests: function (validBidRequests, bidderRequest) {
    const request = {
      id: validBidRequests[0].auctionId,
      imp: validBidRequests.map(slot => mapImpression(slot)),
      site: mapSite(validBidRequests),
      cur: DEFAULT_CURRENCY_ARR,
      test: validBidRequests[0].params.test || 0
    };
    if (bidderRequest && bidderRequest.gdprConsent && bidderRequest.gdprConsent.gdprApplies) {
      const consentStr = (bidderRequest.gdprConsent.consentString)
        ? bidderRequest.gdprConsent.consentString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
      const gdpr = bidderRequest.gdprConsent.gdprApplies ? 1 : 0;
      request.regs = {ext: {gdpr: gdpr}};
      request.user = {ext: {consent: consentStr}};
    }

    return {
      method: 'POST',
      url: buildEndpointUrl(validBidRequests[0].params.region),
      data: JSON.stringify(request)
    };
  },
  interpretResponse: function (serverResponse, originalRequest) {
    const responseBody = serverResponse.body;
    if (!utils.isArray(responseBody)) {
      return [];
    }

    const bids = [];
    responseBody.forEach(serverBid => {
      if (serverBid.price === 0) {
        return;
      }
      if (serverBid.adm.startsWith('{"native')) {
        bids.push(interpretNativeBid(serverBid));
      } else {
        bids.push(interpretBannerBid(serverBid));
      }
    });
    return bids;
  }
};

function buildEndpointUrl(region) {
  return 'https://' + region + '.' + ENDPOINT_URL;
}

/**
 * Produces OpenRTB Imp object from a slot config
 */
function mapImpression(slot) {
  return {
    id: slot.bidId,
    banner: mapBanner(slot),
    native: mapNative(slot),
    tagid: slot.adUnitCode.toString()
  };
}

/**
 * Produces OpenRTB Banner object
 */
function mapBanner(slot) {
  if (slot.mediaType === 'banner' ||
    utils.deepAccess(slot, 'mediaTypes.banner') ||
    (!slot.mediaType && !slot.mediaTypes)) {
    return {
      w: slot.sizes[0][0],
      h: slot.sizes[0][1],
      format: slot.sizes.map(size => ({
        w: size[0],
        h: size[1]
      }))
    };
  }
}

/**
 * Produces an OpenRTB Site object
 */
function mapSite(validRequest) {
  const pubId = validRequest && validRequest.length > 0
    ? validRequest[0].params.publisherId : 'unknown';
  return {
    publisher: {
      id: pubId.toString(),
    },
    page: utils.getTopWindowUrl(),
    name: utils.getOrigin()
  }
}

/**
 * Produces an OpenRTB Native object from a slot config
 */
function mapNative(slot) {
  if (slot.mediaType === 'native' || utils.deepAccess(slot, 'mediaTypes.native')) {
    return {
      request: {
        assets: mapNativeAssets(slot)
      },
      ver: '1.1'
    }
  }
}

/**
 * Produces an OpenRTB Native Ads Assets objects
 */
function mapNativeAssets(slot) {
  const params = slot.nativeParams || utils.deepAccess(slot, 'mediaTypes.native');
  const assets = [];
  if (params.title) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.TITLE,
      required: params.title.required ? 1 : 0,
      title: {
        len: params.title.len || 140
      }
    })
  }
  if (params.image) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.IMAGE,
      required: params.image.required ? 1 : 0,
      img: mapNativeImage(params.image, OPENRTB.NATIVE.IMAGE_TYPE.MAIN)
    })
  }
  if (params.icon) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.ICON,
      required: params.icon.required ? 1 : 0,
      img: mapNativeImage(params.icon, OPENRTB.NATIVE.IMAGE_TYPE.ICON)
    })
  }
  if (params.sponsoredBy) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.SPONSORED,
      required: params.sponsoredBy.required ? 1 : 0,
      data: {
        type: OPENRTB.NATIVE.DATA_ASSET_TYPE.SPONSORED
      }
    })
  }
  if (params.body) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.BODY,
      required: params.body.request ? 1 : 0,
      data: {
        type: OPENRTB.NATIVE.DATA_ASSET_TYPE.DESC,
        len: params.body.len || undefined
      }
    })
  }
  if (params.clickUrl) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.CLICK_URL,
      required: params.clickUrl.required ? 1 : 0,
      data: {
        type: OPENRTB.NATIVE.DATA_ASSET_TYPE.CLICK_URL
      }
    })
  }
  if (params.cta) {
    assets.push({
      id: OPENRTB.NATIVE.ASSET_ID.CTA,
      required: params.cta.required ? 1 : 0,
      data: {
        type: OPENRTB.NATIVE.DATA_ASSET_TYPE.CTA_TEXT,
        len: params.cta.len || undefined
      }
    })
  }
  return assets;
}

/**
 * Produces an OpenRTB Native Ads Image object
 */
function mapNativeImage(image, type) {
  const img = {type: type};
  if (image.aspect_ratios) {
    const ratio = image.aspect_ratios[0];
    const minWidth = ratio.min_width || 100;
    img.wmin = minWidth;
    img.hmin = (minWidth / ratio.ratio_width * ratio.ratio_height);
  }
  if (image.sizes) {
    const size = Array.isArray(image.sizes[0]) ? image.sizes[0] : image.sizes;
    img.w = size[0];
    img.h = size[1];
  }
  return img
}

/**
 * Produces Prebid bidObject from OpenRTB Bid object
 */
function interpretBannerBid(serverBid) {
  return {
    requestId: serverBid.impid,
    mediaType: BANNER,
    cpm: serverBid.price,
    creativeId: serverBid.adid,
    ad: serverBid.adm,
    width: serverBid.w,
    height: serverBid.h,
    ttl: 55,
    netRevenue: true,
    currency: 'USD'
  }
}

/**
 * Produces Prebid bidObject from OpenRTB Bid object
 */
function interpretNativeBid(serverBid) {
  return {
    requestId: serverBid.impid,
    mediaType: NATIVE,
    cpm: serverBid.price,
    creativeId: serverBid.adid,
    width: 1,
    height: 1,
    ttl: 55,
    netRevenue: true,
    currency: 'USD',
    native: interpretNativeAd(serverBid.adm),
  }
}

/**
 * Produces Prebid bidObject.native from OpenRTB Native Ad Markup
 */
function interpretNativeAd(adm) {
  const native = JSON.parse(adm).native;
  const result = {
    clickUrl: encodeURIComponent(native.link.url),
    impressionTrackers: native.imptrackers
  };
  native.assets.forEach(asset => {
    switch (asset.id) {
      case OPENRTB.NATIVE.ASSET_ID.TITLE:
        result.title = asset.title.text;
        break;
      case OPENRTB.NATIVE.ASSET_ID.IMAGE:
        result.image = {
          url: encodeURIComponent(asset.img.url),
          width: asset.img.w,
          height: asset.img.h
        };
        break;
      case OPENRTB.NATIVE.ASSET_ID.ICON:
        result.icon = {
          url: encodeURIComponent(asset.img.url),
          width: asset.img.w,
          height: asset.img.h
        };
        break;
      case OPENRTB.NATIVE.ASSET_ID.BODY:
        result.body = asset.data.value;
        break;
      case OPENRTB.NATIVE.ASSET_ID.SPONSORED:
        result.sponsoredBy = asset.data.value;
        break;
      case OPENRTB.NATIVE.ASSET_ID.CLICK_URL:
        result.clickUrl = encodeURIComponent(asset.data.value);
        break;
      case OPENRTB.NATIVE.ASSET_ID.CTA:
        result.cta = asset.data.value;
        break;
    }
  });
  return result;
}

registerBidder(spec);
