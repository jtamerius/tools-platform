# Full list of Google News supported countries with their RSS feed parameters.
# Format: (country_code, language_code, locale, display_name)
# RSS URL: https://news.google.com/rss?hl={locale}&gl={country_code}&ceid={country_code}:{language_code}

COUNTRIES = [
    # North America
    ("US", "en", "en-US", "United States"),
    ("CA", "en", "en-CA", "Canada"),
    ("MX", "es", "es-MX", "Mexico"),

    # Central America & Caribbean
    ("CU", "es", "es-CU", "Cuba"),
    ("GT", "es", "es-GT", "Guatemala"),
    ("HN", "es", "es-HN", "Honduras"),
    ("SV", "es", "es-SV", "El Salvador"),
    ("NI", "es", "es-NI", "Nicaragua"),
    ("CR", "es", "es-CR", "Costa Rica"),
    ("PA", "es", "es-PA", "Panama"),
    ("DO", "es", "es-DO", "Dominican Republic"),
    ("PR", "es", "es-PR", "Puerto Rico"),

    # South America
    ("BR", "pt", "pt-BR", "Brazil"),
    ("AR", "es", "es-AR", "Argentina"),
    ("CL", "es", "es-CL", "Chile"),
    ("CO", "es", "es-CO", "Colombia"),
    ("PE", "es", "es-PE", "Peru"),
    ("VE", "es", "es-VE", "Venezuela"),
    ("EC", "es", "es-EC", "Ecuador"),
    ("BO", "es", "es-BO", "Bolivia"),
    ("PY", "es", "es-PY", "Paraguay"),
    ("UY", "es", "es-UY", "Uruguay"),

    # Western Europe
    ("GB", "en", "en-GB", "United Kingdom"),
    ("IE", "en", "en-IE", "Ireland"),
    ("FR", "fr", "fr-FR", "France"),
    ("DE", "de", "de-DE", "Germany"),
    ("AT", "de", "de-AT", "Austria"),
    ("CH", "de", "de-CH", "Switzerland"),
    ("IT", "it", "it-IT", "Italy"),
    ("ES", "es", "es-ES", "Spain"),
    ("PT", "pt", "pt-PT", "Portugal"),
    ("NL", "nl", "nl-NL", "Netherlands"),
    ("BE", "fr", "fr-BE", "Belgium"),
    ("LU", "fr", "fr-LU", "Luxembourg"),

    # Nordic
    ("SE", "sv", "sv-SE", "Sweden"),
    ("NO", "no", "no-NO", "Norway"),
    ("DK", "da", "da-DK", "Denmark"),
    ("FI", "fi", "fi-FI", "Finland"),

    # Eastern Europe
    ("PL", "pl", "pl-PL", "Poland"),
    ("CZ", "cs", "cs-CZ", "Czech Republic"),
    ("SK", "sk", "sk-SK", "Slovakia"),
    ("HU", "hu", "hu-HU", "Hungary"),
    ("RO", "ro", "ro-RO", "Romania"),
    ("BG", "bg", "bg-BG", "Bulgaria"),
    ("HR", "hr", "hr-HR", "Croatia"),
    ("SI", "sl", "sl-SI", "Slovenia"),
    ("RS", "sr", "sr-RS", "Serbia"),
    ("UA", "uk", "uk-UA", "Ukraine"),
    ("BY", "be", "be-BY", "Belarus"),
    ("LT", "lt", "lt-LT", "Lithuania"),
    ("LV", "lv", "lv-LV", "Latvia"),
    ("EE", "et", "et-EE", "Estonia"),
    ("GR", "el", "el-GR", "Greece"),

    # Russia
    ("RU", "ru", "ru-RU", "Russia"),

    # Middle East
    ("IL", "he", "he-IL", "Israel"),
    ("SA", "ar", "ar-SA", "Saudi Arabia"),
    ("AE", "ar", "ar-AE", "United Arab Emirates"),
    ("EG", "ar", "ar-EG", "Egypt"),
    ("IQ", "ar", "ar-IQ", "Iraq"),
    ("JO", "ar", "ar-JO", "Jordan"),
    ("KW", "ar", "ar-KW", "Kuwait"),
    ("LB", "ar", "ar-LB", "Lebanon"),
    ("LY", "ar", "ar-LY", "Libya"),
    ("MA", "fr", "fr-MA", "Morocco"),
    ("TN", "fr", "fr-TN", "Tunisia"),
    ("DZ", "fr", "fr-DZ", "Algeria"),
    ("TR", "tr", "tr-TR", "Turkey"),

    # Sub-Saharan Africa
    ("NG", "en", "en-NG", "Nigeria"),
    ("ZA", "en", "en-ZA", "South Africa"),
    ("KE", "en", "en-KE", "Kenya"),
    ("GH", "en", "en-GH", "Ghana"),
    ("TZ", "en", "en-TZ", "Tanzania"),
    ("UG", "en", "en-UG", "Uganda"),
    ("ET", "en", "en-ET", "Ethiopia"),
    ("SN", "fr", "fr-SN", "Senegal"),
    ("CI", "fr", "fr-CI", "Ivory Coast"),
    ("CM", "fr", "fr-CM", "Cameroon"),

    # South Asia
    ("IN", "en", "en-IN", "India"),
    ("PK", "en", "en-PK", "Pakistan"),
    ("BD", "bn", "bn-BD", "Bangladesh"),
    ("LK", "en", "en-LK", "Sri Lanka"),
    ("NP", "ne", "ne-NP", "Nepal"),

    # East Asia
    ("CN", "zh-Hans", "zh-CN", "China"),
    ("JP", "ja", "ja-JP", "Japan"),
    ("KR", "ko", "ko-KR", "South Korea"),
    ("TW", "zh-Hant", "zh-TW", "Taiwan"),
    ("HK", "zh-Hant", "zh-HK", "Hong Kong"),
    ("MN", "mn", "mn-MN", "Mongolia"),

    # Southeast Asia
    ("SG", "en", "en-SG", "Singapore"),
    ("PH", "en", "en-PH", "Philippines"),
    ("MY", "ms", "ms-MY", "Malaysia"),
    ("ID", "id", "id-ID", "Indonesia"),
    ("TH", "th", "th-TH", "Thailand"),
    ("VN", "vi", "vi-VN", "Vietnam"),

    # Oceania
    ("AU", "en", "en-AU", "Australia"),
    ("NZ", "en", "en-NZ", "New Zealand"),
]
