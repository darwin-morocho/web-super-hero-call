import React from "react";
import io from "socket.io-client";
import "./app.scss";
import { async } from "q";

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
  pc: RTCPeerConnection | null = null;
  localStream: MediaStream | null = null;
  localVideo: HTMLVideoElement | null = null;
  remoteVideo: HTMLVideoElement | null = null;
  incommingOffer: RTCSessionDescription = null;
  socket: SocketIOClient.Socket | null = null;

  state = {
    heroes: null,
    me: null,
    him: null,
    status: Status.default
  };

  createPeer() {
    this.pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: ["stun:stun.stunprotocol.org"]
        }
      ]
    });

    this.pc!.addEventListener("icecandidate", event => {
      if (!event.candidate) {
        console.log("ice is null");
        return;
      }

      const { him }: { him: ISuperHero | null } = this.state;

      if (him != null) {
        console.log("enviando ice", event.candidate);
        this.socket!.emit("candidate", {
          him: him.name,
          candidate: event.candidate
        });
      }
    });

    this.pc!.addEventListener("track", event => {
      // we received a media stream from the other person. as we're sure
      // we're sending only video streams, we can safely use the first
      // stream we got. by assigning it to srcObject, it'll be rendered
      // in our video tag, just like a normal video

      console.log("tenemos video", event);
      if (event.track.kind == "video") {
        this.remoteVideo!.srcObject = event.streams[0];
        this.localVideo!.play();
      }
    });

    // our local stream can provide different tracks, e.g. audio and
    // video. even though we're just using the video track, we should
    // add all tracks to the webrtc connection
    for (const track of this.localStream.getTracks()) {
      this.pc!.addTrack(track, this.localStream);
    }
  }

  componentDidMount() {
    // get the audio and video
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: { width: 480, height: 640 } })
      .then((stream: MediaStream) => {
        this.localStream = stream;
        // play our local stream
        this.localVideo!.srcObject = this.localStream;
        this.localVideo!.play();

        this.connect();
      });
  }

  // connect to our socket.io server
  connect() {
    this.socket = io.connect("https://backend-super-hero-call.herokuapp.com");
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

    this.socket!.on("on-disconnected", (heroName: string) => {
      this.pc = null;
      this.setState(prevState => {
        let { heroes } = prevState;
        let hero = heroes![heroName] as ISuperHero;
        hero.isTaken = false;
        heroes[heroName] = hero;

        return { heroes };
      });
    });

    // incoming call
    this.socket!.on(
      "on-request",
      async ({
        superHeroName,
        requestId,
        offer
      }: {
        superHeroName: string;
        requestId: string;
        offer: any | null;
      }) => {
        const { heroes } = this.state;
        this.requestId = requestId;
        this.incommingOffer = offer;
        this.setState({
          him: heroes![superHeroName] as ISuperHero,
          status: Status.icomming
        });
      }
    );

    // response to our call request
    this.socket!.on("on-response", async (answer: any | null) => {
      if (answer) {
        // if the other user accepted our call
        await this.pc!.setRemoteDescription(answer);
        const { heroes } = this.state;
        this.setState({
          status: Status.inCalling
        });
      } else {
        this.requestId = null;
        this.pc=null;
        this.setState({
          status: Status.default
        });
      }
    });

    this.socket!.on("on-candidate", async (candiate: RTCIceCandidateInit) => {
      console.log("on-candidate", candiate);

      if (this.pc != null && this.state.him) {
        await this.pc!.addIceCandidate(candiate);
      }
    });

    this.socket!.on("on-finish-call", () => {
      this.requestId = null;
      this.pc=null;
      this.setState({
        him: null,
        status: Status.default
      });
    });

    this.socket!.on("on-cancel-request", () => {
      this.incommingOffer = null;
      this.pc=null;
      this.setState({ him: null, status: Status.default });
    });
  }

  callTo = async (superHeroName: string) => {
    const { heroes } = this.state;
    this.createPeer();
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    console.log("llamando");
    this.socket!.emit("request", {
      superHeroName,
      offer
    });
    this.setState({
      status: Status.calling,
      him: heroes![superHeroName] as ISuperHero
    });
  };

  acceptOrDecline = async (accept: boolean) => {
    if (accept) {
      this.createPeer();
      await this.pc!.setRemoteDescription(this.incommingOffer);
      const answer = await this.pc!.createAnswer();
      await this.pc!.setLocalDescription(answer);
      this.socket!.emit("response", {
        requestId: this.requestId,
        answer
      });
      this.setState({ status: Status.inCalling });
    } else {
      this.socket!.emit("response", {
        requestId: this.requestId,
        answer: null
      });
      this.setState({ status: Status.default, him: null });
    }
  };

  finishCall = () => {
    this.socket!.emit("finish-call", null);
    this.setState({ status: Status.default, him: null });
    this.pc = null;
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
          className={status === Status.inCalling?'d-block':'d-none'}
          style={{ zIndex: 99 }}
        />

        <div className="d-flex">
          <video
            id="remote-video"
            ref={ref => (this.remoteVideo = ref)}
            autoPlay
            muted={false}
            playsInline
            className={status === Status.inCalling?'d-block':'d-none'}
            style={{ height: "100vh" }}
          />

          {heroes && status !== Status.inCalling && (
            <div id="connected-heroes" className="pa-right-20">
              <div>
                {Object.keys(heroes!)
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
                        <h3 className="c-white">{hero.name}</h3>
                        <button
                          type="button"
                          className="btn bg-red"
                          onClick={() => this.callTo(hero.name)}
                        >
                          <i className="material-icons f-40">call</i>
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {!me && (
          <div id="picker" className="d-flex ai-center jc-center t-center">
            <div>
              <h3 className="c-white f-20 uppercase">Pick your hero</h3>
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
          <div
            className="fixed left-0 right-0 bottom-0 top-0 bg  d-flex flex-column ai-center jc-center"
            style={{ zIndex: 99 }}
          >
            <div>
              <img className="avatar" src={him.avatar} />
            </div>
            <div className="ma-top-20">
              <button
                className="btn bg-green"
                type="button"
                onClick={() => this.acceptOrDecline(true)}
              >
                <i className="material-icons f-40">call</i>
              </button>
              <button
                className="ma-left-50 btn bg-red"
                type="button"
                onClick={() => this.acceptOrDecline(false)}
              >
                <i className="material-icons f-40">call_end</i>
              </button>
            </div>
          </div>
        )}

        {status == Status.calling && (
          <div
            className="fixed left-0 right-0 bottom-0 top-0 bg  d-flex flex-column ai-center jc-center"
            style={{ zIndex: 99 }}
          >
            <img className="avatar" src={him.avatar} />
            <button
              className="ma-top-30 btn bg-red"
              type="button"
              onClick={() => {
                this.socket!.emit("cancel-request");
                this.setState({ him: null, status: Status.default });
              }}
            >
              <i className="material-icons f-40">call_end</i>
            </button>
          </div>
        )}

        {status == Status.inCalling && (
          <div
            className="fixed left-0 right-0 bottom-30  d-flex ai-center jc-center"
            style={{ zIndex: 99 }}
          >
            <button
              className="ma-left-20 btn bg-red"
              type="button"
              onClick={this.finishCall}
            >
              <i className="material-icons f-40">call_end</i>
            </button>
          </div>
        )}
      </div>
    );
  }
}

export default App;
