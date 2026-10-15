export function detectSetupPlatform({userAgent='',platform='',maxTouchPoints=0,userAgentData}={}){
 if(/android/i.test(userAgentData?.platform||'')||/android/i.test(userAgent))return 'android';
 if(/iPad|iPhone|iPod/i.test(userAgent)||(/Mac/i.test(platform)||/Macintosh/i.test(userAgent))&&maxTouchPoints>1)return 'apple';
 return '';
}
