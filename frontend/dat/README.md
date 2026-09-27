# 檔案結構 (還在慢慢修改中)
frontend/
└── dat/
    ├── index.html               單人的遊戲說明頁面     
    ├── double.html              雙人的遊戲頁面     
    ├── single_.html             單人遊戲遊玩頁面    
    ├── README.md                     
    ├── assets/                  素材(背景、準心、動物等)     
    │   ├── background.png
    │   ├── crosshair.png
    │   └── animals/
    │       ├── 動物.png
    │       └── rabbit-hit-mask.js
    ├── css/                          
    │   ├── single.css                
    │   ├── double.css                
    │   └── single_tutorial.css              
    └── js/                          
        ├── double_api.js   雙人的資料庫 API call
        ├── double_game.js   雙人的遊戲邏輯與方法
        ├── double_main.js   雙人的遊戲架構
        ├── double_questions.js   雙人的問題生成
        ├── single_api.js   單人的資料庫 API call
        ├── single_questions.js   單人的問題生成
        ├── single_tutorial.js   單人的遊戲說明                     
        └── single.js   單人的主要遊戲畫面、遊玩邏輯，修改題目的關卡數、題目數、時間在這邊                              