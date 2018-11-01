/*jshint esversion: 6 */
var MicrobitBLE = function() {
  // デバイス情報保持用変数
  this.ble_device = null;

  // ローパスフィルタのための変数
  this.accel_x_before = 0;
  this.accel_y_before = 0;
  this.accel_z_before = 0;  
}

let ourMicrobitUART = null;


class MicroBitUART {
  constructor(rxCharacteristic, txCharacteristic) {
      this.messageSubscribers = [];
      this.rxCharacteristic = rxCharacteristic;
      this.txCharacteristic = txCharacteristic;
      this.decoder = new TextDecoder();
      this.txCharacteristic.startNotifications().then(characteristic => {
          characteristic.addEventListener('characteristicvaluechanged', ev => {
              let value = (event.target).value;
              let valueAsString = new TextDecoder().decode(value);
              this.handleNewMessage(valueAsString);
          });
      });
  }
  subscribeToMessages(receiver) {
      this.messageSubscribers.push(receiver);
  }
  handleNewMessage(message) {
      this.messageSubscribers.forEach(subscriber => {
          subscriber(message);
      });
  }
  send(key, value) {
      let kvstring = `${key}:${value}#`;
      let encoder = new TextEncoder('utf-8');
      let encoded = encoder.encode(kvstring);
      this.rxCharacteristic.writeValue(encoded);
      console.log("write:" + kvstring);
  }
}


MicrobitBLE.prototype = {
  // Class定数定義

  // micro:bit BLE UUID 加速度センサー関連
  ACCELEROMETERSERVICE_SERVICE_UUID: 'e95d0753-251d-470a-a062-fa1922dfa9a8',
  ACCELEROMETERDATA_CHARACTERISTIC_UUID: 'e95dca4b-251d-470a-a062-fa1922dfa9a8',
  ACCELEROMETERPERIOD_CHARACTERISTIC_UUID: 'e95dfb24-251d-470a-a062-fa1922dfa9a8',

  // micro:bit BLE UUID 温度計関連
  TEMPERATURE_SERVICE_UUID: 'e95d6100-251d-470a-a062-fa1922dfa9a8',
  TEMPERATUREDATA_CHARACTERISTIC_UUID: 'e95d9250-251d-470a-a062-fa1922dfa9a8',
  TEMPERATURE_PERIOD_UUID: 'e95d1b25-251d-470a-a062-fa1922dfa9a8',

  // micro:bit BLE UUID ボタン関連
  BUTTON_SERVICE_UUID: 'e95d9882-251d-470a-a062-fa1922dfa9a8',
  BUTTON_A_CHARACTERISTIC_UUID: 'e95dda90-251d-470a-a062-fa1922dfa9a8',
  BUTTON_B_CHARACTERISTIC_UUID: 'e95dda91-251d-470a-a062-fa1922dfa9a8',
  

  // micro:bit UART ボタン関連
  MICROBIT_UART_SERVICE: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),
  MICROBIT_UART_WRITE: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),
  MICROBIT_UART_READ: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),

  // micro:bitの加速度センサーデータ書き換え期間
  ACCELEROMETERPERIOD: 80,

  //  温度変更間隔
  TEMPERATURPERIOD: 160,

  // micro:bitのセンサー値のローパスフィルタ用設定値
  ACCELEROMETER_ALPHA: 0.9,

  // 接続関数（Promiseによる非同期逐次処理(.thenの部分)）
  connect: function() {
    navigator.bluetooth.requestDevice({ // デバイスの検索
      filters: [{
        namePrefix: 'BBC micro:bit',
      }],
      // 使いたいSERVICEのUUIDを列挙する
      optionalServices: [this.ACCELEROMETERSERVICE_SERVICE_UUID, this.BUTTON_SERVICE_UUID,
                         this.TEMPERATURE_SERVICE_UUID, this.MICROBIT_UART_SERVICE]
    })
    .then(device => {
      this.ble_device = device;
      console.log("device", device);
      // GATTサーバへの接続
      return device.gatt.connect();
    })
    .then(server =>{
      console.log("server", server);
      // Promise.allは、全てを並列処理して、全てが終わったら次に進む
      return Promise.all([
        server.getPrimaryService(this.ACCELEROMETERSERVICE_SERVICE_UUID),
        server.getPrimaryService(this.BUTTON_SERVICE_UUID),
        server.getPrimaryService(this.TEMPERATURE_SERVICE_UUID),
        server.getPrimaryService(this.MICROBIT_UART_SERVICE)
      ]);
    })
    .then(service => {
      console.log("service", service);
      return Promise.all([
        service[0].getCharacteristic(this.ACCELEROMETERPERIOD_CHARACTERISTIC_UUID),
        service[0].getCharacteristic(this.ACCELEROMETERDATA_CHARACTERISTIC_UUID),
        service[1].getCharacteristic(this.BUTTON_A_CHARACTERISTIC_UUID),
        service[1].getCharacteristic(this.BUTTON_B_CHARACTERISTIC_UUID),
        service[2].getCharacteristic(this.TEMPERATURE_PERIOD_UUID),
        service[2].getCharacteristic(this.TEMPERATUREDATA_CHARACTERISTIC_UUID),
        service[3].getCharacteristic(this.MICROBIT_UART_WRITE),
        service[3].getCharacteristic(this.MICROBIT_UART_READ)
      ]);
    })
    .then(chara => {
      console.log("ACCELEROMETER:", chara);
      alert("BLE接続が完了しました。");
      var buffer = new Uint8Array(2);
      buffer[0] = this.ACCELEROMETERPERIOD & 255;
      buffer[1] = this.ACCELEROMETERPERIOD >> 8;
      chara[0].writeValue(buffer);
      chara[1].startNotifications();
      chara[1].addEventListener('characteristicvaluechanged',this.onAccelerometerValueChanged.bind(this));

      //ボタンが押された際の通知を有効化し、ボタンクリックイベントにコールバックを設定
      chara[2].startNotifications();
      chara[2].addEventListener('characteristicvaluechanged', this.onchangeABtn.bind(this));
      chara[3].startNotifications();
      chara[3].addEventListener('characteristicvaluechanged', this.onchangeBBtn.bind(this));
      //  温度情報の追加
      chara[4].writeValue(new Uint16Array([this.TEMPERATURPERIOD]))
      chara[5].startNotifications();
      chara[5].addEventListener('characteristicvaluechanged',this.onChangeTemperature.bind(this));

      //  uartの設定
      ourMicrobitUART = new MicroBitUART(chara[6], chara[7]);
      startReadingFromUART(ourMicrobitUART);
      
    })
    .catch(error => {
      alert("BLE接続に失敗しました。もう一度試してみてください");
      console.log(error);
    });
  },
  disconnect: function() {
    if (!this.ble_device || !this.ble_device.gatt.connected) return ;
    this.ble_device.gatt.disconnect();
    alert("BLE接続を切断しました。");
  },
  onAccelerometerValueChanged: function(event) {
    // ６ｂｙｔｅの値から２ｂｙｔｅずつ切り出す
    accel_x = event.target.value.getInt16(0, true);
    accel_y = event.target.value.getInt16(2, true);
    accel_z = event.target.value.getInt16(4, true);
    // console.log("Accelerometer data converted: x=" + accel_x + " y=" + accel_y + " z=" + accel_z);
    document.getElementById("accel-x").value = accel_x;
    document.getElementById("accel-y").value = accel_y;
    document.getElementById("accel-z").value = accel_z;

    // おまけ：ローパスフィルタでノイズをある程度除く
    this.accel_x_before = this.ACCELEROMETER_ALPHA * this.accel_x_before + (1.0 - this.ACCELEROMETER_ALPHA) * accel_x;
    this.accel_y_before = this.ACCELEROMETER_ALPHA * this.accel_y_before + (1.0 - this.ACCELEROMETER_ALPHA) * accel_y;
    this.accel_z_before = this.ACCELEROMETER_ALPHA * this.accel_z_before + (1.0 - this.ACCELEROMETER_ALPHA) * accel_z;
    // console.log("Smoothed accelerometer data: x=" + this.accel_x_before + " y=" + this.accel_y_before + " z=" + this.accel_z_before);
  },
  onChangeTemperature: function(event){
    let temperature = event.target.value.getUint8(0, true)
    document.getElementById("temperature").value = temperature;
  },
  onchangeABtn: function() {
    alert("A Button");
    console.log("A Button");
  },
  onchangeBBtn: function() {
    alert("B Button");
    console.log("B Button");
  }
};

function startReadingFromUART(mbit) {
  mbit.subscribeToMessages(sayHelloBack);
}
function sayHelloBack(message) {
  console.log("send message");
  ourMicrobitUART.send("hello:", "response:");
}

function helloClicked(e) {
  console.log("say hello");
  ourMicrobitUART.send("hello:", "dude:");
}

window.onload = function () {
  var microbitBLE = new MicrobitBLE();
  document.getElementById("connect-button").addEventListener("click", microbitBLE.connect.bind(microbitBLE), false);
  document.getElementById("disconnect-button").addEventListener("click", microbitBLE.disconnect.bind(microbitBLE), false);
};
helloButton.onclick = helloClicked;
