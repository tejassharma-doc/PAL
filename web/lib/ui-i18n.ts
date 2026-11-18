'use client'

/**
 * Curated UI translations for the redesigned app.
 *
 * Keyed by the English source string, so wrapping is natural — t('Home') — and any
 * string that isn't wrapped, or isn't in a pack, simply falls back to English.
 * Covers the main Indian languages (hi, mr, gu, ta, te, bn, kn). Other languages
 * fall back to English until a pack is added. "PAL" is a product name — never keyed.
 *
 * Current language comes from localStorage `pal_preferred_lang` (set by Settings),
 * and the hook re-renders on the `storage` / `pal-uiprefs` events Settings fires.
 */
import { useCallback, useEffect, useState } from 'react'

type Pack = Record<string, string>

const hi: Pack = {
  'Home': 'होम', 'Ask': 'पूछें', 'Medicines': 'दवाइयाँ', 'Visits': 'विज़िट', 'Records': 'रिकॉर्ड', 'Family': 'परिवार', 'Settings': 'सेटिंग्स', 'Help': 'मदद', 'Notifications': 'सूचनाएँ',
  'doctor-anchored care': 'डॉक्टर-आधारित देखभाल', 'Viewing your record': 'आपका रिकॉर्ड देख रहे हैं',
  'Ask PAL': 'PAL से पूछें', 'Health records': 'स्वास्थ्य रिकॉर्ड', 'Profile': 'प्रोफ़ाइल', 'Reminders': 'रिमाइंडर',
  'Membership': 'सदस्यता', 'Reading': 'पढ़ना', 'Text size': 'टेक्स्ट आकार', 'Standard': 'मानक', 'Large': 'बड़ा', 'Largest': 'सबसे बड़ा',
  'High contrast': 'उच्च कंट्रास्ट', 'Read answers aloud': 'उत्तर ज़ोर से पढ़ें', 'Language': 'भाषा', 'Privacy': 'गोपनीयता', 'Account': 'खाता',
  'Sign out': 'साइन आउट', 'Mobile number': 'मोबाइल नंबर', 'Who can see my record': 'मेरा रिकॉर्ड कौन देख सकता है', 'Use my record without asking': 'बिना पूछे मेरा रिकॉर्ड उपयोग करें',
  'Help improve PAL': 'PAL को बेहतर बनाने में मदद करें', 'Download my data': 'मेरा डेटा डाउनलोड करें', 'Profile and emergency contact': 'प्रोफ़ाइल और आपातकालीन संपर्क',
  'Good morning': 'शुभ प्रभात', 'Good afternoon': 'शुभ दोपहर', 'Good evening': 'शुभ संध्या',
  'Needs your attention': 'आपके ध्यान की ज़रूरत', 'Latest readings': 'नवीनतम रीडिंग', 'Next visit': 'अगली विज़िट', 'See all': 'सभी देखें',
  'Add a report': 'रिपोर्ट जोड़ें', 'Take a photo': 'फ़ोटो लें', 'Choose a file': 'फ़ाइल चुनें', 'Open': 'खोलें',
  'Yes, I took it': 'हाँ, मैंने ले ली', 'In 10 minutes': '10 मिनट में', 'Skip this dose': 'यह खुराक छोड़ें',
  'Coming up': 'आगामी', 'Past visits': 'पिछली विज़िट', 'Answer pre-visit questions': 'विज़िट-पूर्व प्रश्नों के उत्तर दें',
  'Prescription': 'प्रिस्क्रिप्शन', 'What the doctor said': 'डॉक्टर ने क्या कहा', 'Care plan': 'देखभाल योजना',
  'Key readings': 'मुख्य रीडिंग', 'Reports and documents': 'रिपोर्ट और दस्तावेज़',
  'Ask about your health, in any language': 'अपनी सेहत के बारे में, किसी भी भाषा में पूछें', 'New question': 'नया प्रश्न', 'Past questions': 'पिछले प्रश्न', 'Thinking…': 'सोच रहे हैं…',
  'All your medicines': 'आपकी सभी दवाइयाँ', 'No upcoming visits.': 'कोई आगामी विज़िट नहीं।', 'Your family': 'आपका परिवार', 'Your groups': 'आपके समूह',
}

const mr: Pack = {
  'Home': 'होम', 'Ask': 'विचारा', 'Medicines': 'औषधे', 'Visits': 'भेटी', 'Records': 'नोंदी', 'Family': 'कुटुंब', 'Settings': 'सेटिंग्ज', 'Help': 'मदत', 'Notifications': 'सूचना',
  'doctor-anchored care': 'डॉक्टर-आधारित काळजी', 'Viewing your record': 'तुमचा रेकॉर्ड पाहत आहात',
  'Ask PAL': 'PAL ला विचारा', 'Health records': 'आरोग्य नोंदी', 'Profile': 'प्रोफाइल', 'Reminders': 'स्मरणपत्रे',
  'Membership': 'सदस्यत्व', 'Reading': 'वाचन', 'Text size': 'मजकूर आकार', 'Standard': 'मानक', 'Large': 'मोठा', 'Largest': 'सर्वात मोठा',
  'High contrast': 'उच्च कॉन्ट्रास्ट', 'Read answers aloud': 'उत्तरे मोठ्याने वाचा', 'Language': 'भाषा', 'Privacy': 'गोपनीयता', 'Account': 'खाते',
  'Sign out': 'साइन आउट', 'Mobile number': 'मोबाइल नंबर', 'Who can see my record': 'माझा रेकॉर्ड कोण पाहू शकतो', 'Use my record without asking': 'न विचारता माझा रेकॉर्ड वापरा',
  'Help improve PAL': 'PAL सुधारण्यात मदत करा', 'Download my data': 'माझा डेटा डाउनलोड करा', 'Profile and emergency contact': 'प्रोफाइल व आणीबाणी संपर्क',
  'Good morning': 'शुभ सकाळ', 'Good afternoon': 'शुभ दुपार', 'Good evening': 'शुभ संध्याकाळ',
  'Needs your attention': 'तुमचे लक्ष हवे', 'Latest readings': 'अलीकडील रीडिंग', 'Next visit': 'पुढील भेट', 'See all': 'सर्व पाहा',
  'Add a report': 'अहवाल जोडा', 'Take a photo': 'फोटो काढा', 'Choose a file': 'फाइल निवडा', 'Open': 'उघडा',
  'Yes, I took it': 'होय, मी घेतली', 'In 10 minutes': '10 मिनिटांत', 'Skip this dose': 'ही मात्रा वगळा',
  'Coming up': 'आगामी', 'Past visits': 'मागील भेटी', 'Answer pre-visit questions': 'भेटीपूर्व प्रश्नांची उत्तरे द्या',
  'Prescription': 'प्रिस्क्रिप्शन', 'What the doctor said': 'डॉक्टर काय म्हणाले', 'Care plan': 'काळजी योजना',
  'Key readings': 'मुख्य रीडिंग', 'Reports and documents': 'अहवाल व कागदपत्रे',
  'Ask about your health, in any language': 'तुमच्या आरोग्याबद्दल, कोणत्याही भाषेत विचारा', 'New question': 'नवीन प्रश्न', 'Past questions': 'मागील प्रश्न', 'Thinking…': 'विचार करत आहे…',
  'All your medicines': 'तुमची सर्व औषधे', 'No upcoming visits.': 'आगामी भेटी नाहीत.', 'Your family': 'तुमचे कुटुंब', 'Your groups': 'तुमचे समूह',
}

const gu: Pack = {
  'Home': 'હોમ', 'Ask': 'પૂછો', 'Medicines': 'દવાઓ', 'Visits': 'મુલાકાતો', 'Records': 'રેકોર્ડ્સ', 'Family': 'કુટુંબ', 'Settings': 'સેટિંગ્સ', 'Help': 'મદદ', 'Notifications': 'સૂચનાઓ',
  'doctor-anchored care': 'ડૉક્ટર-આધારિત સંભાળ', 'Viewing your record': 'તમારો રેકોર્ડ જોઈ રહ્યા છો',
  'Ask PAL': 'PAL ને પૂછો', 'Health records': 'આરોગ્ય રેકોર્ડ્સ', 'Profile': 'પ્રોફાઇલ', 'Reminders': 'રિમાઇન્ડર',
  'Membership': 'સભ્યપદ', 'Reading': 'વાંચન', 'Text size': 'ટેક્સ્ટ કદ', 'Standard': 'પ્રમાણભૂત', 'Large': 'મોટું', 'Largest': 'સૌથી મોટું',
  'High contrast': 'ઉચ્ચ કોન્ટ્રાસ્ટ', 'Read answers aloud': 'જવાબો મોટેથી વાંચો', 'Language': 'ભાષા', 'Privacy': 'ગોપનીયતા', 'Account': 'ખાતું',
  'Sign out': 'સાઇન આઉટ', 'Mobile number': 'મોબાઇલ નંબર', 'Who can see my record': 'મારો રેકોર્ડ કોણ જોઈ શકે', 'Use my record without asking': 'પૂછ્યા વિના મારો રેકોર્ડ વાપરો',
  'Help improve PAL': 'PAL સુધારવામાં મદદ કરો', 'Download my data': 'મારો ડેટા ડાઉનલોડ કરો', 'Profile and emergency contact': 'પ્રોફાઇલ અને કટોકટી સંપર્ક',
  'Good morning': 'શુભ સવાર', 'Good afternoon': 'શુભ બપોર', 'Good evening': 'શુભ સાંજ',
  'Needs your attention': 'તમારા ધ્યાનની જરૂર', 'Latest readings': 'તાજેતરના રીડિંગ', 'Next visit': 'આગલી મુલાકાત', 'See all': 'બધું જુઓ',
  'Add a report': 'રિપોર્ટ ઉમેરો', 'Take a photo': 'ફોટો લો', 'Choose a file': 'ફાઇલ પસંદ કરો', 'Open': 'ખોલો',
  'Yes, I took it': 'હા, મેં લીધી', 'In 10 minutes': '10 મિનિટમાં', 'Skip this dose': 'આ ડોઝ છોડો',
  'Coming up': 'આગામી', 'Past visits': 'ભૂતકાળની મુલાકાતો', 'Answer pre-visit questions': 'મુલાકાત પહેલાંના પ્રશ્નોના જવાબ આપો',
  'Prescription': 'પ્રિસ્ક્રિપ્શન', 'What the doctor said': 'ડૉક્ટરે શું કહ્યું', 'Care plan': 'સંભાળ યોજના',
  'Key readings': 'મુખ્ય રીડિંગ', 'Reports and documents': 'રિપોર્ટ અને દસ્તાવેજો',
  'Ask about your health, in any language': 'તમારા સ્વાસ્થ્ય વિશે, કોઈપણ ભાષામાં પૂછો', 'New question': 'નવો પ્રશ્ન', 'Past questions': 'ભૂતકાળના પ્રશ્નો', 'Thinking…': 'વિચારી રહ્યું છે…',
  'All your medicines': 'તમારી બધી દવાઓ', 'No upcoming visits.': 'કોઈ આગામી મુલાકાત નથી.', 'Your family': 'તમારું કુટુંબ', 'Your groups': 'તમારા જૂથો',
}

const ta: Pack = {
  'Home': 'முகப்பு', 'Ask': 'கேளுங்கள்', 'Medicines': 'மருந்துகள்', 'Visits': 'வருகைகள்', 'Records': 'பதிவுகள்', 'Family': 'குடும்பம்', 'Settings': 'அமைப்புகள்', 'Help': 'உதவி', 'Notifications': 'அறிவிப்புகள்',
  'doctor-anchored care': 'மருத்துவர் அடிப்படையிலான பராமரிப்பு', 'Viewing your record': 'உங்கள் பதிவைப் பார்க்கிறீர்கள்',
  'Ask PAL': 'PAL-ஐ கேளுங்கள்', 'Health records': 'சுகாதாரப் பதிவுகள்', 'Profile': 'சுயவிவரம்', 'Reminders': 'நினைவூட்டல்கள்',
  'Membership': 'உறுப்பினர்', 'Reading': 'வாசிப்பு', 'Text size': 'எழுத்து அளவு', 'Standard': 'நிலையான', 'Large': 'பெரியது', 'Largest': 'மிகப் பெரியது',
  'High contrast': 'அதிக மாறுபாடு', 'Read answers aloud': 'பதில்களை சத்தமாக படியுங்கள்', 'Language': 'மொழி', 'Privacy': 'தனியுரிமை', 'Account': 'கணக்கு',
  'Sign out': 'வெளியேறு', 'Mobile number': 'மொபைல் எண்', 'Who can see my record': 'என் பதிவை யார் பார்க்கலாம்', 'Use my record without asking': 'கேட்காமல் என் பதிவைப் பயன்படுத்து',
  'Help improve PAL': 'PAL-ஐ மேம்படுத்த உதவுங்கள்', 'Download my data': 'என் தரவைப் பதிவிறக்கு', 'Profile and emergency contact': 'சுயவிவரம் மற்றும் அவசர தொடர்பு',
  'Good morning': 'காலை வணக்கம்', 'Good afternoon': 'மதிய வணக்கம்', 'Good evening': 'மாலை வணக்கம்',
  'Needs your attention': 'உங்கள் கவனம் தேவை', 'Latest readings': 'சமீபத்திய அளவீடுகள்', 'Next visit': 'அடுத்த வருகை', 'See all': 'அனைத்தையும் பார்',
  'Add a report': 'அறிக்கையைச் சேர்', 'Take a photo': 'புகைப்படம் எடு', 'Choose a file': 'கோப்பைத் தேர்ந்தெடு', 'Open': 'திற',
  'Yes, I took it': 'ஆம், எடுத்துக்கொண்டேன்', 'In 10 minutes': '10 நிமிடத்தில்', 'Skip this dose': 'இந்த அளவைத் தவிர்',
  'Coming up': 'வரவிருக்கும்', 'Past visits': 'கடந்த வருகைகள்', 'Answer pre-visit questions': 'வருகைக்கு முந்தைய கேள்விகளுக்கு பதிலளி',
  'Prescription': 'மருந்துச்சீட்டு', 'What the doctor said': 'மருத்துவர் சொன்னது', 'Care plan': 'பராமரிப்பு திட்டம்',
  'Key readings': 'முக்கிய அளவீடுகள்', 'Reports and documents': 'அறிக்கைகள் மற்றும் ஆவணங்கள்',
  'Ask about your health, in any language': 'உங்கள் உடல்நலம் பற்றி, எந்த மொழியிலும் கேளுங்கள்', 'New question': 'புதிய கேள்வி', 'Past questions': 'கடந்த கேள்விகள்', 'Thinking…': 'யோசிக்கிறது…',
  'All your medicines': 'உங்கள் அனைத்து மருந்துகள்', 'No upcoming visits.': 'வரவிருக்கும் வருகைகள் இல்லை.', 'Your family': 'உங்கள் குடும்பம்', 'Your groups': 'உங்கள் குழுக்கள்',
}

const te: Pack = {
  'Home': 'హోమ్', 'Ask': 'అడగండి', 'Medicines': 'మందులు', 'Visits': 'సందర్శనలు', 'Records': 'రికార్డులు', 'Family': 'కుటుంబం', 'Settings': 'సెట్టింగ్‌లు', 'Help': 'సహాయం', 'Notifications': 'నోటిఫికేషన్లు',
  'doctor-anchored care': 'డాక్టర్-ఆధారిత సంరక్షణ', 'Viewing your record': 'మీ రికార్డును చూస్తున్నారు',
  'Ask PAL': 'PAL ని అడగండి', 'Health records': 'ఆరోగ్య రికార్డులు', 'Profile': 'ప్రొఫైల్', 'Reminders': 'రిమైండర్లు',
  'Membership': 'సభ్యత్వం', 'Reading': 'చదవడం', 'Text size': 'టెక్స్ట్ పరిమాణం', 'Standard': 'ప్రామాణిక', 'Large': 'పెద్దది', 'Largest': 'అతిపెద్దది',
  'High contrast': 'హై కాంట్రాస్ట్', 'Read answers aloud': 'సమాధానాలను గట్టిగా చదవండి', 'Language': 'భాష', 'Privacy': 'గోప్యత', 'Account': 'ఖాతా',
  'Sign out': 'సైన్ అవుట్', 'Mobile number': 'మొబైల్ నంబర్', 'Who can see my record': 'నా రికార్డును ఎవరు చూడగలరు', 'Use my record without asking': 'అడగకుండా నా రికార్డును వాడండి',
  'Help improve PAL': 'PAL ను మెరుగుపరచడంలో సహాయపడండి', 'Download my data': 'నా డేటాను డౌన్‌లోడ్ చేయండి', 'Profile and emergency contact': 'ప్రొఫైల్ మరియు అత్యవసర సంప్రదింపు',
  'Good morning': 'శుభోదయం', 'Good afternoon': 'శుభ మధ్యాహ్నం', 'Good evening': 'శుభ సాయంత్రం',
  'Needs your attention': 'మీ దృష్టి అవసరం', 'Latest readings': 'తాజా రీడింగ్‌లు', 'Next visit': 'తదుపరి సందర్శన', 'See all': 'అన్నీ చూడండి',
  'Add a report': 'నివేదికను జోడించండి', 'Take a photo': 'ఫోటో తీయండి', 'Choose a file': 'ఫైల్ ఎంచుకోండి', 'Open': 'తెరవండి',
  'Yes, I took it': 'అవును, తీసుకున్నాను', 'In 10 minutes': '10 నిమిషాల్లో', 'Skip this dose': 'ఈ డోస్ వదిలేయండి',
  'Coming up': 'రాబోయే', 'Past visits': 'గత సందర్శనలు', 'Answer pre-visit questions': 'సందర్శనకు ముందు ప్రశ్నలకు సమాధానం ఇవ్వండి',
  'Prescription': 'ప్రిస్క్రిప్షన్', 'What the doctor said': 'డాక్టర్ చెప్పినది', 'Care plan': 'సంరక్షణ ప్రణాళిక',
  'Key readings': 'ముఖ్య రీడింగ్‌లు', 'Reports and documents': 'నివేదికలు మరియు పత్రాలు',
  'Ask about your health, in any language': 'మీ ఆరోగ్యం గురించి, ఏ భాషలోనైనా అడగండి', 'New question': 'కొత్త ప్రశ్న', 'Past questions': 'గత ప్రశ్నలు', 'Thinking…': 'ఆలోచిస్తోంది…',
  'All your medicines': 'మీ అన్ని మందులు', 'No upcoming visits.': 'రాబోయే సందర్శనలు లేవు.', 'Your family': 'మీ కుటుంబం', 'Your groups': 'మీ గ్రూపులు',
}

const bn: Pack = {
  'Home': 'হোম', 'Ask': 'জিজ্ঞাসা', 'Medicines': 'ওষুধ', 'Visits': 'ভিজিট', 'Records': 'রেকর্ড', 'Family': 'পরিবার', 'Settings': 'সেটিংস', 'Help': 'সাহায্য', 'Notifications': 'বিজ্ঞপ্তি',
  'doctor-anchored care': 'ডাক্তার-ভিত্তিক যত্ন', 'Viewing your record': 'আপনার রেকর্ড দেখছেন',
  'Ask PAL': 'PAL কে জিজ্ঞাসা করুন', 'Health records': 'স্বাস্থ্য রেকর্ড', 'Profile': 'প্রোফাইল', 'Reminders': 'অনুস্মারক',
  'Membership': 'সদস্যপদ', 'Reading': 'পড়া', 'Text size': 'টেক্সট আকার', 'Standard': 'স্ট্যান্ডার্ড', 'Large': 'বড়', 'Largest': 'সবচেয়ে বড়',
  'High contrast': 'উচ্চ কনট্রাস্ট', 'Read answers aloud': 'উত্তর জোরে পড়ুন', 'Language': 'ভাষা', 'Privacy': 'গোপনীয়তা', 'Account': 'অ্যাকাউন্ট',
  'Sign out': 'সাইন আউট', 'Mobile number': 'মোবাইল নম্বর', 'Who can see my record': 'আমার রেকর্ড কে দেখতে পারে', 'Use my record without asking': 'না জিজ্ঞাসা করে আমার রেকর্ড ব্যবহার করুন',
  'Help improve PAL': 'PAL উন্নত করতে সাহায্য করুন', 'Download my data': 'আমার ডেটা ডাউনলোড করুন', 'Profile and emergency contact': 'প্রোফাইল ও জরুরি যোগাযোগ',
  'Good morning': 'শুভ সকাল', 'Good afternoon': 'শুভ অপরাহ্ন', 'Good evening': 'শুভ সন্ধ্যা',
  'Needs your attention': 'আপনার মনোযোগ প্রয়োজন', 'Latest readings': 'সর্বশেষ রিডিং', 'Next visit': 'পরবর্তী ভিজিট', 'See all': 'সব দেখুন',
  'Add a report': 'রিপোর্ট যোগ করুন', 'Take a photo': 'ছবি তুলুন', 'Choose a file': 'ফাইল নির্বাচন করুন', 'Open': 'খুলুন',
  'Yes, I took it': 'হ্যাঁ, নিয়েছি', 'In 10 minutes': '১০ মিনিটে', 'Skip this dose': 'এই ডোজ এড়িয়ে যান',
  'Coming up': 'আসন্ন', 'Past visits': 'অতীত ভিজিট', 'Answer pre-visit questions': 'ভিজিটের আগের প্রশ্নের উত্তর দিন',
  'Prescription': 'প্রেসক্রিপশন', 'What the doctor said': 'ডাক্তার যা বলেছেন', 'Care plan': 'যত্ন পরিকল্পনা',
  'Key readings': 'মূল রিডিং', 'Reports and documents': 'রিপোর্ট ও নথি',
  'Ask about your health, in any language': 'আপনার স্বাস্থ্য সম্পর্কে, যেকোনো ভাষায় জিজ্ঞাসা করুন', 'New question': 'নতুন প্রশ্ন', 'Past questions': 'অতীত প্রশ্ন', 'Thinking…': 'ভাবছে…',
  'All your medicines': 'আপনার সব ওষুধ', 'No upcoming visits.': 'কোনো আসন্ন ভিজিট নেই।', 'Your family': 'আপনার পরিবার', 'Your groups': 'আপনার গ্রুপ',
}

const kn: Pack = {
  'Home': 'ಮುಖಪುಟ', 'Ask': 'ಕೇಳಿ', 'Medicines': 'ಔಷಧಿಗಳು', 'Visits': 'ಭೇಟಿಗಳು', 'Records': 'ದಾಖಲೆಗಳು', 'Family': 'ಕುಟುಂಬ', 'Settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು', 'Help': 'ಸಹಾಯ', 'Notifications': 'ಅಧಿಸೂಚನೆಗಳು',
  'doctor-anchored care': 'ವೈದ್ಯ-ಆಧಾರಿತ ಆರೈಕೆ', 'Viewing your record': 'ನಿಮ್ಮ ದಾಖಲೆ ವೀಕ್ಷಿಸುತ್ತಿದ್ದೀರಿ',
  'Ask PAL': 'PAL ಗೆ ಕೇಳಿ', 'Health records': 'ಆರೋಗ್ಯ ದಾಖಲೆಗಳು', 'Profile': 'ಪ್ರೊಫೈಲ್', 'Reminders': 'ಜ್ಞಾಪನೆಗಳು',
  'Membership': 'ಸದಸ್ಯತ್ವ', 'Reading': 'ಓದುವಿಕೆ', 'Text size': 'ಪಠ್ಯ ಗಾತ್ರ', 'Standard': 'ಪ್ರಮಾಣಿತ', 'Large': 'ದೊಡ್ಡದು', 'Largest': 'ಅತಿ ದೊಡ್ಡದು',
  'High contrast': 'ಹೆಚ್ಚಿನ ಕಾಂಟ್ರಾಸ್ಟ್', 'Read answers aloud': 'ಉತ್ತರಗಳನ್ನು ಗಟ್ಟಿಯಾಗಿ ಓದಿ', 'Language': 'ಭಾಷೆ', 'Privacy': 'ಗೌಪ್ಯತೆ', 'Account': 'ಖಾತೆ',
  'Sign out': 'ಸೈನ್ ಔಟ್', 'Mobile number': 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ', 'Who can see my record': 'ನನ್ನ ದಾಖಲೆ ಯಾರು ನೋಡಬಹುದು', 'Use my record without asking': 'ಕೇಳದೆ ನನ್ನ ದಾಖಲೆ ಬಳಸಿ',
  'Help improve PAL': 'PAL ಸುಧಾರಿಸಲು ಸಹಾಯ ಮಾಡಿ', 'Download my data': 'ನನ್ನ ಡೇಟಾ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ', 'Profile and emergency contact': 'ಪ್ರೊಫೈಲ್ ಮತ್ತು ತುರ್ತು ಸಂಪರ್ಕ',
  'Good morning': 'ಶುಭೋದಯ', 'Good afternoon': 'ಶುಭ ಮಧ್ಯಾಹ್ನ', 'Good evening': 'ಶುಭ ಸಂಜೆ',
  'Needs your attention': 'ನಿಮ್ಮ ಗಮನ ಅಗತ್ಯ', 'Latest readings': 'ಇತ್ತೀಚಿನ ರೀಡಿಂಗ್‌ಗಳು', 'Next visit': 'ಮುಂದಿನ ಭೇಟಿ', 'See all': 'ಎಲ್ಲಾ ನೋಡಿ',
  'Add a report': 'ವರದಿ ಸೇರಿಸಿ', 'Take a photo': 'ಫೋಟೋ ತೆಗೆಯಿರಿ', 'Choose a file': 'ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ', 'Open': 'ತೆರೆಯಿರಿ',
  'Yes, I took it': 'ಹೌದು, ತೆಗೆದುಕೊಂಡೆ', 'In 10 minutes': '10 ನಿಮಿಷದಲ್ಲಿ', 'Skip this dose': 'ಈ ಡೋಸ್ ಬಿಟ್ಟುಬಿಡಿ',
  'Coming up': 'ಮುಂಬರುವ', 'Past visits': 'ಹಿಂದಿನ ಭೇಟಿಗಳು', 'Answer pre-visit questions': 'ಭೇಟಿಗೆ ಮೊದಲಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ',
  'Prescription': 'ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್', 'What the doctor said': 'ವೈದ್ಯರು ಹೇಳಿದ್ದು', 'Care plan': 'ಆರೈಕೆ ಯೋಜನೆ',
  'Key readings': 'ಪ್ರಮುಖ ರೀಡಿಂಗ್‌ಗಳು', 'Reports and documents': 'ವರದಿಗಳು ಮತ್ತು ದಾಖಲೆಗಳು',
  'Ask about your health, in any language': 'ನಿಮ್ಮ ಆರೋಗ್ಯದ ಬಗ್ಗೆ, ಯಾವುದೇ ಭಾಷೆಯಲ್ಲಿ ಕೇಳಿ', 'New question': 'ಹೊಸ ಪ್ರಶ್ನೆ', 'Past questions': 'ಹಿಂದಿನ ಪ್ರಶ್ನೆಗಳು', 'Thinking…': 'ಯೋಚಿಸುತ್ತಿದೆ…',
  'All your medicines': 'ನಿಮ್ಮ ಎಲ್ಲಾ ಔಷಧಿಗಳು', 'No upcoming visits.': 'ಮುಂಬರುವ ಭೇಟಿಗಳಿಲ್ಲ.', 'Your family': 'ನಿಮ್ಮ ಕುಟುಂಬ', 'Your groups': 'ನಿಮ್ಮ ಗುಂಪುಗಳು',
}

const PACKS: Record<string, Pack> = { hi, mr, gu, ta, te, bn, kn }

/** Translate an English UI string for the current language (falls back to English). */
export function translate(lang: string, en: string): string {
  return PACKS[lang]?.[en] ?? en
}

export function useUiT() {
  const [lang, setLang] = useState('en')
  useEffect(() => {
    const read = () => setLang(localStorage.getItem('pal_preferred_lang') || 'en')
    read()
    const h = () => read()
    window.addEventListener('storage', h)
    window.addEventListener('pal-uiprefs', h)
    return () => { window.removeEventListener('storage', h); window.removeEventListener('pal-uiprefs', h) }
  }, [])
  const t = useCallback((en: string) => translate(lang, en), [lang])
  return { t, lang }
}
