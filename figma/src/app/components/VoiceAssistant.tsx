import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, MapPin, Car, Hash, User, Bot, Navigation } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet when using bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface AssistantData {
  location: string;
  coordinates: [number, number];
  vehicle: string;
  agentStatus: 'online' | 'busy' | 'offline';
  phone: string;
  bookingId: string;
}

interface TranscriptMessage {
  role: 'user' | 'agent';
  message: string;
  timestamp: Date;
}

export default function VoiceAssistant() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([
    {
      role: 'agent',
      message: 'Hello. I am your roadside assistance AI agent. Please describe your situation and I will coordinate help.',
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [assistantData] = useState<AssistantData>({
    location: '123 Main St, San Francisco, CA 94102',
    coordinates: [37.7799, -122.4144],
    vehicle: 'Toyota Camry 2020 (ABC123)',
    agentStatus: 'online',
    phone: '+1 (555) 123-4567',
    bookingId: 'RA-2026-05-03-4521',
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [transcript]);

  const handleMicToggle = () => {
    setIsListening(!isListening);

    // Simulate user speaking and agent response
    if (!isListening) {
      setTimeout(() => {
        setTranscript(prev => [
          ...prev,
          {
            role: 'user',
            message: 'My car has a flat tire on Highway 101.',
            timestamp: new Date(),
          },
        ]);

        setIsListening(false);

        // Simulate agent response
        setTimeout(() => {
          setTranscript(prev => [
            ...prev,
            {
              role: 'agent',
              message: 'I have recorded a flat tire. Dispatching a technician to your location. Expected arrival is 15 minutes. Please remain in a safe location.',
              timestamp: new Date(),
            },
          ]);
        }, 1500);
      }, 2500);
    }
  };

  const getStatusColor = (status: AssistantData['agentStatus']) => {
    switch (status) {
      case 'online':
        return 'bg-emerald-500';
      case 'busy':
        return 'bg-amber-500';
      case 'offline':
        return 'bg-rose-500';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-100 via-blue-50 to-cyan-100 font-sans text-zinc-900 selection:bg-violet-200">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-6 border-b border-white/60">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">
              Roadside Assistance AI
            </h1>
            <p className="text-sm text-violet-700 mt-1 font-medium">
              Emergency Support Dashboard
            </p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center">
            <div className="flex items-center gap-2.5 px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-violet-200 rounded-full shadow-sm">
              <div className="relative flex h-2.5 w-2.5">
                {assistantData.agentStatus === 'online' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${getStatusColor(assistantData.agentStatus)}`}></span>
              </div>
              <span className="text-xs font-medium text-violet-700 capitalize">
                Agent {assistantData.agentStatus}
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column - Map & Details */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Map Section */}
            <section className="bg-white/90 backdrop-blur-sm rounded-xl border border-violet-200 shadow-lg overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-violet-600" />
                <h2 className="text-sm font-semibold text-violet-900">Current Location</h2>
              </div>
              <div className="h-[280px] bg-zinc-100 relative z-0">
                <MapContainer 
                  center={assistantData.coordinates} 
                  zoom={14} 
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%', zIndex: 0 }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={assistantData.coordinates}>
                    <Popup>
                      <span className="font-medium">{assistantData.location}</span>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </section>

            {/* Details Section */}
            <section className="bg-white/90 backdrop-blur-sm rounded-xl border border-violet-200 shadow-lg">
              <div className="px-5 py-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50">
                <h2 className="text-sm font-semibold text-violet-900">Incident Details</h2>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 gap-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-gradient-to-br from-amber-100 to-orange-100 text-orange-600 flex-shrink-0">
                      <Hash className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-violet-600 uppercase tracking-wider mb-0.5">Booking ID</p>
                      <p className="text-sm font-medium text-zinc-900">{assistantData.bookingId}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-gradient-to-br from-rose-100 to-pink-100 text-rose-600 flex-shrink-0">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-violet-600 uppercase tracking-wider mb-0.5">Location</p>
                      <p className="text-sm font-medium text-zinc-900">{assistantData.location}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-600 flex-shrink-0">
                      <Car className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-violet-600 uppercase tracking-wider mb-0.5">Vehicle</p>
                      <p className="text-sm font-medium text-zinc-900">{assistantData.vehicle}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 flex-shrink-0">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-violet-600 uppercase tracking-wider mb-0.5">Contact</p>
                      <p className="text-sm font-medium text-zinc-900">{assistantData.phone}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column - Chat & Voice */}
          <div className="lg:col-span-7">
            <section className="bg-white/90 backdrop-blur-sm rounded-xl border border-violet-200 shadow-lg overflow-hidden flex flex-col h-[700px]">

              <div className="px-5 py-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50 flex justify-between items-center">
                <h2 className="text-sm font-semibold text-violet-900">Live Conversation</h2>
                <div className="text-xs text-violet-600 flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  AI Voice Agent Active
                </div>
              </div>

              {/* Transcript Area */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-white">
                {transcript.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      
                      <div className="flex-shrink-0 mt-1">
                        {msg.role === 'user' ? (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-200 to-purple-200 flex items-center justify-center text-violet-700">
                            <User className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center text-cyan-700 border border-cyan-200">
                            <Bot className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`px-4 py-3 rounded-2xl ${
                            msg.role === 'user'
                              ? 'bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-tr-sm shadow-md'
                              : 'bg-gradient-to-br from-cyan-50 to-blue-50 text-zinc-900 rounded-tl-sm border border-cyan-200'
                          }`}
                        >
                          <p className="text-[15px] leading-relaxed">{msg.message}</p>
                        </div>
                        <span className="text-[11px] font-medium text-violet-400 mt-1.5 px-1">
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* Typing Indicator / Active Listening */}
                {isListening && (
                  <div className="flex justify-end">
                    <div className="flex gap-3 max-w-[85%] flex-row-reverse">
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-200 to-purple-200 flex items-center justify-center text-violet-700">
                          <User className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="px-4 py-4 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-tr-sm flex items-center gap-1.5 shadow-md">
                          <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                          <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                          <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Voice Control Bottom Bar */}
              <div className="p-5 bg-gradient-to-r from-violet-50 to-blue-50 border-t border-violet-100 flex flex-col items-center justify-center">
                <button
                  onClick={handleMicToggle}
                  className={`relative group flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 ${
                    isListening
                      ? 'bg-gradient-to-br from-rose-500 to-pink-500 text-white hover:from-rose-600 hover:to-pink-600 shadow-lg shadow-rose-500/30'
                      : 'bg-gradient-to-br from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 shadow-lg shadow-violet-500/30'
                  }`}
                  aria-label={isListening ? "Stop listening" : "Start speaking"}
                >
                  {isListening && (
                    <span className="absolute inset-0 rounded-full border-2 border-rose-400 animate-ping opacity-30"></span>
                  )}
                  {isListening ? (
                    <MicOff className="w-6 h-6" />
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </button>
                <div className="mt-3 text-center">
                  <p className={`text-sm font-medium ${isListening ? 'text-rose-600' : 'text-violet-700'}`}>
                    {isListening ? 'Listening...' : 'Tap to speak'}
                  </p>
                </div>
              </div>

            </section>
          </div>

        </div>
      </div>
    </div>
  );
}
