$(() => {
  console.debug("document ready");

  const htmlClass = {
    dialPad: ".dial-pad",
    hangup: ".hangup",
    statusOnline: ".status-online",
    numberDig: ".number-dig",
    dtmfString: ".dtmf-string",
  };

  const htmlId = {
    deviceStatusValue: "#device-status-value",
    log: "#log",
    logEntries: "#log-entries",
    microphoneSelect: "#microphone-select",
    speakerSelect: "#speaker-select"
  };

  const htmlTag = {
    input: "input"
  };

  const errorCode = {
    tokenExpired: 31205
  };

  const maxLogEntries = 10;

  let device;
  let connection;

  let selectedMicrophone;
  function setSelectedMicrophone(id, name) {
    selectedMicrophone = { id, name };
  }
  
  let selectedSpeaker;
  function setSelectedSpeaker(id, name) {
    selectedSpeaker = { id, name };
  }

  const queryParams = new URLSearchParams(window.location.search);
  // Supports passing the token in the URL as https://domain.com/index.html?token=XXXXXXXX
  const token = queryParams.get("token");
  if (token) {
    initializeTwilioDevice(token);
    window.history.replaceState({}, document.title, "/index.html");
  } else {
    log("Requesting Access Token...");
    $.getJSON("./voice-token")
      .then((data) => {
        log("Got a token");
  
        // Setup Twilio.Device
        initializeTwilioDevice(data.token);
      })
      .catch((err) => {
        console.error(err);
        log("Could not get a token from server");
      });
  }

  function initializeTwilioDevice(token) {
    device = new Twilio.Device(token, {
      // Set Opus as our preferred codec. Opus generally performs better, requiring less bandwidth and
      // providing better audio quality in restrained network conditions. Opus will be default in 2.0.
      codecPreferences: ["opus", "pcmu"],
      // Use fake DTMF tones client-side. Real tones are still sent to the other end of the call,
      // but the client-side DTMF tones are fake. This prevents the local mic capturing the DTMF tone
      // a second time and sending the tone twice. This will be default in 2.0.
      fakeLocalDTMF: true,
      // Use `enableRingingState` to enable the device to emit the `ringing`
      // state. The TwiML backend also needs to have the attribute
      // `answerOnBridge` also set to true in the `Dial` verb. This option
      // changes the behavior of the SDK to consider a call `ringing` starting
      // from the connection to the TwiML backend to when the recipient of
      // the `Dial` verb answers.
      enableRingingState: true
    });

    device.on("ready", function(device) {
      log("Twilio.Device Ready");
      $(htmlId.deviceStatusValue).html("Online");
      $(htmlId.deviceStatusValue).addClass("status-online");

      device.audio.on('deviceChange', () => initializeUserMedia());

      initializeUserMedia();
    });

    device.on("offline", function(device) {
      log("Twilio.Device Offline");
      $(htmlId.deviceStatusValue).html("Offline");
      $(htmlId.deviceStatusValue).removeClass("status-online");
      disableDialpadButtons();
    })

    device.on("error", function(error) {
      log("Twilio.Device Error: " + error.message);
      console.error('Twilio.Device error:', error);
      if (error.code === errorCode.tokenExpired) {
        handleTokenExpiration();
      }
    });

    device.on("connect", function(conn) {
      log("Successfully established call!");
      connection = conn;
      enableDialpadButtons();
    });

    device.on("disconnect", function(conn) {
      log("Call ended.");
      device.audio.unsetInputDevice();
      connection = undefined;
      disableDialpadButtons();
    });

    device.on("incoming", function(conn) {
      log("Incoming call from " + conn.parameters.From);
      device.audio.setInputDevice(selectedMicrophone.id)
        .then(() => conn.accept())
        .catch(error => {
          console.error('Error accepting connection.', error);
          log(`Error answering call. ${error.message}`);
        })
    });

    disableDialpadButtons();
  }

  function disableDialpadButtons() {
    $(`${htmlClass.numberDig}, ${htmlClass.hangup}`).addClass("disabled");
  }

  function enableDialpadButtons() {
    $(`${htmlClass.numberDig}, ${htmlClass.hangup}`).removeClass("disabled");
  }

  function initializeUserMedia() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      updateMicOptions();
      updateSpeakerOptions();
      stream.getTracks().forEach(track => track.stop());
      log("Microphone ready");
    }).catch(error => {
      console.error('Error during getUserMedia to validate microphone.', error);
      log(`Error detected with the microphone. ${error.message}`);
    })
  }

  function changeActiveMicrophone() {
    navigator.mediaDevices.getUserMedia({ audio: { deviceId: selectedMicrophone.id }}).then(stream => {
      stream.getTracks().forEach(track => track.stop());
      if (connection) {
        device.audio.setInputDevice(selectedMicrophone.id)
      }
      log(`Microphone changed to ${selectedMicrophone.name}`);
    }).catch(error => {
      console.error(`Error changing microphone to ${selectedMicrophone.name}.`, error);
      log(`Error changing microphone to ${selectedMicrophone.name}. ${error.message}` );
    })
  }

  function changeActiveSpeaker() {
    device.audio.speakerDevices.set(selectedSpeaker.id);
    log(`Speaker changed to ${selectedSpeaker.name}`);
  }

  function updateMicOptions() {
    $(htmlId.microphoneSelect).html("");
    device.audio.availableInputDevices.forEach(d => {
      $(htmlId.microphoneSelect).append(new Option(d.label, d.deviceId));
    });
    const selectedOption = $(`${htmlId.microphoneSelect} option:selected`);
    setSelectedMicrophone(selectedOption.val(), selectedOption.text());
  }

  function updateSpeakerOptions() {
    $(htmlId.speakerSelect).html("");
    device.audio.availableOutputDevices.forEach(d => {
      $(htmlId.speakerSelect).append(new Option(d.label, d.deviceId));
    });
    const selectedOption = $(`${htmlId.speakerSelect} option:selected`);
    setSelectedSpeaker(selectedOption.val(), selectedOption.text());
  }

  function handleDialpadDigit(digit) {
    const dtmfStringInput = $(`${htmlClass.dtmfString} ${htmlTag.input}`);
    var currentValue = dtmfStringInput.val();
    dtmfStringInput.val(currentValue + digit);
    dtmfStringInput.scrollLeft(dtmfStringInput.prop("scrollWidth"));
    if (connection) {
      connection.sendDigits(digit);
    }
  }

  function addAnimationToButton(thisButton) {
    $(thisButton).removeClass("clicked");
    var _this = thisButton;
    setTimeout(function(){
      $(_this).addClass("clicked");
    },1);
  };

  function handleTokenExpiration() {
    const tokenRefreshInterval = setInterval(() => {
      if (device && device.activeConnection()) {
        // Will wait until the active call ends before we destroy the current device
        return;
      }
      try {
        device.destroy();
      } catch (error) {
        console.error("Error destroying Twilio.Device:", error);
      }

      $.getJSON("./voice-token")
      .then((data) => {
        log("Got a token");
  
        initializeTwilioDevice(data.token);
      })
      .catch((err) => {
        console.error(err);
        log("Could not get a token from server");
      });
      
      clearInterval(tokenRefreshInterval);
    }, 1000);
  }

  // DOM event listeners
  $(htmlClass.numberDig).click(function(){
    const digit = $(this).attr("name");
    addAnimationToButton(this);
    handleDialpadDigit(digit);
  });

  $(htmlClass.hangup).click(function(){
    addAnimationToButton(this);
    if (device) {
      device.disconnectAll();
    }
    $(`${htmlClass.dtmfString} ${htmlTag.input}`).val("");
  })

  $(htmlId.microphoneSelect).change(function () {
    const selectedOption = $(`${htmlId.microphoneSelect} option:selected`);
    setSelectedMicrophone(selectedOption.val(), selectedOption.text());
    changeActiveMicrophone();
  })

  $(htmlId.speakerSelect).change(function() {
    const selectedOption = $(`${htmlId.speakerSelect} option:selected`);
    setSelectedSpeaker(selectedOption.val(), selectedOption.text());
    changeActiveSpeaker();
  })
  
  // Activity log
  function log(message) {
    console.log(message);
    let currentHtml = $(htmlId.logEntries).html();
    $(htmlId.logEntries).html(currentHtml += "<p>&gt;&nbsp;" + message + "</p>");
    $(htmlId.logEntries).scrollTop($(htmlId.logEntries).prop("scrollHeight"));
    
    const logElementCount = $(htmlId.logEntries).children().length;
    if (logElementCount > maxLogEntries) {
      $(htmlId.logEntries).find(":first-child").remove();
    }
  }
})
