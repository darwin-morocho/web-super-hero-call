import React from "react";
import io from "socket.io-client";
import "./app.scss";
import SimplePeer from "simple-peer";

require("webrtc-adapter"); // suport for diferent browsers

export interface ISuperHero {
  name: string;
  avatar: string;
  isTaken: boolean;
  inCall: boolean;
}

enum Status {
  calling,
  icomming,
  default,
  inCalling
}

class App extends React.Component<
  {},
  {
    heroes: any | null;
    me: ISuperHero | null;
    him: ISuperHero | null;
    status: Status;
  }
> {
  requestId: string | null = null;

  offer: any;

  pc?: RTCPeerConnection;
  localStream: MediaStream | null = null;
  localVideo: HTMLVideoElement | null = null;
  remoteVideo: HTMLVideoElement | null = null;

  socket?: SocketIOClient.Socket;

  state = {
    heroes: null,
    me: null,
    him: null,
    status: Status.default
  };

  componentDidMount() {
    // get the audio and video
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((stream: MediaStream) => {
        this.localVideo!.srcObject = stream;
        this.localVideo!.play();
        this.localStream = stream;
        console.log("localStream", stream);
        this.connect();
      });
  }

  // connect to our socket.io server
  connect() {
    this.socket = io.connect("http://localhost:5000");
    this.socket.on("on-connected", (heroes: any) => {
      console.log("heroes", heroes);
      this.setState({ heroes });
    });

    this.socket!.on("on-assigned", (heroName: string | null) => {
      const { heroes } = this.state;
      console.log("assigned", heroName);
      if (heroName) {
        this.setState({ me: heroes![heroName] as ISuperHero });
      }
    });

    this.socket!.on("on-taken", (heroName: string) => {
      this.setState(prevState => {
        let { heroes } = prevState;
        let hero = heroes![heroName] as ISuperHero;
        hero.isTaken = true;
        heroes[heroName] = hero;

        return { heroes };
      });
    });

    // incoming call
    this.socket!.on(
      "on-request",
      ({
        superHeroName,
        requestId,
        data
      }: {
        superHeroName: string;
        requestId: string;
        data: any | null;
      }) => {
        const { heroes } = this.state;
        console.log("requestId", requestId);
        this.requestId = requestId;
        this.offer = data; // {type:"offer",sdp:""}
        this.setState({ him: heroes![superHeroName], status: Status.icomming });
      }
    );

    // response to our call request
    this.socket!.on(
      "on-response",
      ({
        superHeroName,

        data
      }: {
        superHeroName: string;

        data: any | null;
      }) => {
        if (data) {
          console.log("on-response", data);
          // if the other user accepted our call
          this.pc!.setRemoteDescription(data);
          const { heroes } = this.state;
          this.setState({
            status: Status.inCalling
          });
        } else {
          this.requestId = null;
          this.setState({
            status: Status.default
          });
        }
      }
    );

    this.socket!.on("on-candidate", (candiate: RTCIceCandidateInit) => {
      console.log("on-candidate", candiate);
      if (this.pc) {
        this.pc!.addIceCandidate(candiate);
      }
    });

    this.socket!.on("on-finish-call", () => {
      this.requestId = null;
      this.setState({
        him: null,
        status: Status.default
      });
    });
  }

  createPeer(isCaller: boolean = false) {
    this.pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: ["stun:stun.1.google.com:19302"]
        }
      ]
    });

    this.pc!.addEventListener("track", event => {
      // we received a media stream from the other person. as we're sure
      // we're sending only video streams, we can safely use the first
      // stream we got. by assigning it to srcObject, it'll be rendered
      // in our video tag, just like a normal video

      //const src = window.URL.createObjectURL(event.streams[0]);

      console.log("tenemos video", event);
      this.remoteVideo!.srcObject = event.streams[0];
      this.remoteVideo!.play();
    });

    // our local stream can provide different tracks, e.g. audio and
    // video. even though we're just using the video track, we should
    // add all tracks to the webrtc connection
    for (const track of this.localStream!.getTracks()) {
      this.pc!.addTrack(track, this.localStream!);
    }

    if (isCaller) {
      this.pc!.addEventListener("icecandidate", event => {
        if (!event.candidate) {
          console.log("ice is null");
          return;
        }
        console.log("enviando ice");
        this.socket!.emit("candidate", event.candidate);
      });
    }
  }

  callTo = async (superHeroName: string) => {
    const { heroes } = this.state;
    this.createPeer(true);
    const desc = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(desc);
    console.log("llamando");
    this.socket!.emit("request", {
      superHeroName,
      data: {
        type: desc.type,
        sdp: desc.sdp
      }
    });
    this.setState({ status: Status.calling, him: heroes![superHeroName] });
  };

  acceptOrDecline = async (accept: boolean) => {
    if (accept) {
      this.createPeer(false);
      const desc = new RTCSessionDescription(this.offer);
      console.log("accpet", desc);
      await this.pc!.setRemoteDescription(desc);
      const anwser = await this.pc!.createAnswer();
      this.pc!.setLocalDescription(anwser);
      this.socket!.emit("response", {
        requestId: this.requestId,
        data: anwser
      });
      this.setState({ status: Status.inCalling });
    } else {
      this.socket!.emit("response", { requestId: this.requestId, data: null });
      this.setState({ status: Status.default });
    }
  };

  finishCall = () => {
    this.socket!.emit("finish-call", null);
    this.setState({ status: Status.default });
  };

  render() {
    const {
      heroes,
      me,
      him,
      status
    }: {
      heroes: any;
      me: ISuperHero | null;
      him: ISuperHero | null;
      status: Status;
    } = this.state;
    return (
      <div>
        <video
          id="local-video"
          ref={ref => (this.localVideo = ref)}
          playsInline
          autoPlay
          muted
        />

        <div className="d-flex">
          <video
            id="remote-video"
            ref={ref => (this.remoteVideo = ref)}
            autoPlay
            muted={false}
            playsInline
          />

          <div className="ma-left-40">
            {heroes &&
              Object.keys(heroes!)
                .filter(key => {
                  if (me == null) return true;
                  return me!.name != key;
                })
                .map(key => {
                  const hero = (heroes as any)[key];
                  return (
                    <div
                      className="item-hero"
                      key={key}
                      style={{ opacity: hero.isTaken ? 1 : 0.3 }}
                    >
                      <img className="avatar" src={hero.avatar} />
                      <button
                        type="button"
                        onClick={() => this.callTo(hero.name)}
                      >
                        Lamar
                      </button>
                    </div>
                  );
                })}
          </div>
        </div>

        {!me && (
          <div id="picker" className="d-flex ai-center jc-center t-center">
            <div>
              <h3 className="c-white f-20">Pick your hero</h3>
              <div className="d-flex">
                {heroes &&
                  Object.keys(heroes!).map(key => {
                    const hero = (heroes as any)[key];
                    return (
                      <div
                        className="pa-20"
                        key={key}
                        style={{ opacity: hero.isTaken ? 0.3 : 1 }}
                      >
                        <img
                          className="avatar pointer"
                          src={hero.avatar}
                          onClick={() => {
                            if (!hero.isTaken) {
                              this.socket!.emit("pick", hero.name);
                            }
                          }}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {status == Status.icomming && (
          <div className="absosule left-0 right-0 bottom-30 d-flex ai-center jc-center">
            <button type="button" onClick={() => this.acceptOrDecline(true)}>
              ACEPTAR
            </button>
            <button
              className="ma-left-20"
              type="button"
              onClick={() => this.acceptOrDecline(false)}
            >
              CANCELAR
            </button>
          </div>
        )}

        {status == Status.calling && (
          <div className="absosule left-0 right-0 bottom-30  d-flex ai-center jc-center">
            <button
              className="ma-left-20"
              type="button"
              onClick={() => {
                this.socket!.emit("cancel-request");
              }}
            >
              CANCELAR
            </button>
          </div>
        )}

        {status == Status.inCalling && (
          <div className="absosule left-0 right-0 bottom-30  d-flex ai-center jc-center">
            <button
              className="ma-left-20"
              type="button"
              onClick={this.finishCall}
            >
              FINALIZAR
            </button>
          </div>
        )}
      </div>
    );
  }
}

export default App;
