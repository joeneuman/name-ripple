import { useState, useEffect, useRef } from 'react'
import './App.css'
import defaultLists from './data/wordLists.json'

console.log('Loaded default lists:', defaultLists)

function App() {
  const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1)
  const fileInputRef = useRef()
  const resultsRef = useRef()  // Add ref for results section

  // Define our available word lists with localStorage and defaults
  const [wordLists, setWordLists] = useState(() => {
    try {
      const savedLists = localStorage.getItem('wordLists')
      const lists = savedLists ? JSON.parse(savedLists) : defaultLists.lists
      console.log('Initial word lists:', lists)
      return lists
    } catch (error) {
      console.error('Error loading lists:', error)
      return defaultLists.lists
    }
  })

  // Save word lists to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('wordLists', JSON.stringify(wordLists))
    } catch (error) {
      console.error('Error saving lists:', error)
    }
  }, [wordLists])

  // Add a function to reset lists to defaults
  const resetToDefaultLists = () => {
    setWordLists(defaultLists.lists)
    setSelectedLists({ first: null, second: null, third: null })
  }

  const [showListManager, setShowListManager] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [pastedWords, setPastedWords] = useState('')

  const domainExtensions = [
    { id: 3, name: '.com', word: '.com' },
    { id: 4, name: '.net', word: '.net' },
    { id: 5, name: '.io', word: '.io' },
    { id: 6, name: '.app', word: '.app' },
    { id: 7, name: '.dev', word: '.dev' },
    { id: 8, name: '.ai', word: '.ai' },
    { id: 9, name: '.tech', word: '.tech' },
    { id: 10, name: '.co', word: '.co' }
  ]

  // State for selected lists in each position
  const [selectedLists, setSelectedLists] = useState({
    first: null,
    second: null,
    third: null
  })

  const [combinations, setCombinations] = useState([])
  const [availability, setAvailability] = useState({})
  const [checking, setChecking] = useState({})
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false)
  const [currentCheckIndex, setCurrentCheckIndex] = useState(0)
  const [domainStatuses, setDomainStatuses] = useState({})  // New state for detailed status

  const [showMenu, setShowMenu] = useState(false)

  const [isGenerating, setIsGenerating] = useState(false)
  const [baseWord, setBaseWord] = useState('')

  // Auto-check domains one at a time with delay
  useEffect(() => {
    if (combinations.length > 0 && currentCheckIndex < combinations.length) {
      const checkNext = async () => {
        await checkDomainAvailability(combinations[currentCheckIndex])
        setTimeout(() => {
          setCurrentCheckIndex(prev => prev + 1)
        }, 50)
      }
      checkNext()
    }
  }, [combinations, currentCheckIndex])

  const checkDomainAvailability = async (domain) => {
    setChecking(prev => ({ ...prev, [domain]: true }))
    try {
      const response = await fetch(`https://dns.google/resolve?name=${domain}`)
      const data = await response.json()
      
      // Check for different types of responses
      if (data.Status === 3) { // NXDOMAIN - Domain doesn't exist
        setDomainStatuses(prev => ({ ...prev, [domain]: 'unregistered' }))
        setAvailability(prev => ({ ...prev, [domain]: true }))
      } else if (!data.Answer) {
        setDomainStatuses(prev => ({ ...prev, [domain]: 'no-dns' }))
        setAvailability(prev => ({ ...prev, [domain]: false }))
      } else {
        setDomainStatuses(prev => ({ ...prev, [domain]: 'registered' }))
        setAvailability(prev => ({ ...prev, [domain]: false }))
      }
    } catch (error) {
      console.error('Error checking domain:', error)
      setDomainStatuses(prev => ({ ...prev, [domain]: 'error' }))
      setAvailability(prev => ({ ...prev, [domain]: 'error' }))
    }
    setChecking(prev => ({ ...prev, [domain]: false }))
  }

  const generateCombinations = () => {
    if (!selectedLists.first || !selectedLists.second || !selectedLists.third) {
      alert('Please select lists for all positions')
      return
    }

    const firstWords = selectedLists.first.words.map(word => capitalize(word.toLowerCase()))
    const secondWords = selectedLists.second.words.map(word => capitalize(word.toLowerCase()))
    const domain = selectedLists.third.word

    const combos = []
    for (const first of firstWords) {
      for (const second of secondWords) {
        // Concatenate words with capitalized first letters
        combos.push(`${first}${second}${domain}`)
      }
    }
    setCombinations(combos)
    setAvailability({})
    setCurrentCheckIndex(0)
    
    // Scroll to results section
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  const handleListSelect = (position, listId) => {
    if (position === 'third') {
      const selectedDomain = domainExtensions.find(ext => ext.id === Number(listId))
      setSelectedLists(prev => ({
        ...prev,
        third: selectedDomain
      }))
    } else {
      const selectedList = wordLists.find(list => list.id === Number(listId))
      setSelectedLists(prev => ({
        ...prev,
        [position]: selectedList
      }))
    }
  }

  const getDomainStyle = (domain) => {
    if (checking[domain]) return {}
    
    const status = domainStatuses[domain]
    switch (status) {
      case 'unregistered':
        return { fontWeight: 'bold', color: '#10b981' } // Green
      case 'no-dns':
        return { color: '#f59e0b' } // Yellow/Orange
      case 'registered':
        return { textDecoration: 'line-through', color: '#6b7280' } // Gray
      case 'error':
        return { color: '#ef4444' } // Red
      default:
        return {}
    }
  }

  const getDomainStatusText = (domain) => {
    if (checking[domain]) return 'checking...'
    
    const status = domainStatuses[domain]
    switch (status) {
      case 'unregistered':
        return 'Available!'
      case 'no-dns':
        return 'Registered (No DNS)'
      case 'registered':
        return 'Taken'
      case 'error':
        return 'Error checking'
      default:
        return ''
    }
  }

  const filteredCombinations = showOnlyAvailable 
    ? combinations.filter(combo => availability[combo] === true)
    : combinations

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !newListName.trim()) return

    const text = await file.text()
    const words = text.split('\n')
      .map(word => word.trim())
      .filter(word => word.length > 0)

    const newId = Math.max(...wordLists.map(list => list.id), 0) + 1
    setWordLists(prev => [...prev, {
      id: newId,
      name: newListName,
      words
    }])

    // Reset form
    setNewListName('')
    fileInputRef.current.value = ''
  }

  const handleAddList = () => {
    if (!newListName.trim()) {
      alert('Please enter a list name')
      return
    }
    if (!pastedWords.trim()) {
      alert('Please enter or upload some words')
      return
    }

    const words = pastedWords.split('\n')
      .map(word => word.trim())
      .filter(word => word.length > 0)

    if (words.length === 0) {
      alert('No valid words found')
      return
    }

    const newId = Math.max(...wordLists.map(list => list.id), 0) + 1
    setWordLists(prev => [...prev, {
      id: newId,
      name: newListName,
      words
    }])

    // Reset form
    setNewListName('')
    setPastedWords('')
  }

  const deleteList = (id) => {
    setWordLists(prev => prev.filter(list => list.id !== id))
    // If the deleted list was selected, clear that selection
    setSelectedLists(prev => ({
      first: prev.first?.id === id ? null : prev.first,
      second: prev.second?.id === id ? null : prev.second,
      third: prev.third
    }))
  }

  const generateWordList = async (position) => {
    if (!baseWord.trim()) {
      alert('Please enter a word to generate suggestions from')
      return
    }
    
    setIsGenerating(true)
    try {
      const response = await fetch('http://localhost:3000/api/generate-words', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ baseWord: baseWord.trim() })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate words')
      }

      const data = await response.json()
      if (!data.words || data.words.length === 0) {
        throw new Error('No valid words generated')
      }
      
      const newId = Math.max(...wordLists.map(list => list.id), 0) + 1
      const newList = {
        id: newId,
        name: `${capitalize(baseWord)} Related`,
        words: data.words
      }
      
      setWordLists(prev => [...prev, newList])
      handleListSelect(position, newId)
      setBaseWord('')
    } catch (error) {
      console.error('Error generating words:', error)
      alert(error.message || 'Error generating word list. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="app">
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="ripple-filter">
            <feTurbulence 
              type="turbulence" 
              baseFrequency="0.01 0.05" 
              numOctaves="2" 
              result="turbulence" 
            >
              <animate 
                attributeName="baseFrequency" 
                dur="2s" 
                values="0.01 0.05;0.007 0.03;0.01 0.05" 
                repeatCount="1" 
                begin="mouseover"
                end="mouseout"
              />
            </feTurbulence>
            <feDisplacementMap 
              in="SourceGraphic" 
              in2="turbulence" 
              scale="5" 
              xChannelSelector="R" 
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <header>
        <div className="font-showcase">
          <h1 className="ripple-title">
            <span className="ripple-letter" style={{ '--i': 0 }}>N</span>
            <span className="ripple-letter" style={{ '--i': 1 }}>a</span>
            <span className="ripple-letter" style={{ '--i': 2 }}>m</span>
            <span className="ripple-letter" style={{ '--i': 3 }}>e</span>
            <span className="ripple-letter" style={{ '--i': 4 }}>&nbsp;</span>
            <span className="ripple-letter" style={{ '--i': 5 }}>R</span>
            <span className="ripple-letter" style={{ '--i': 6 }}>i</span>
            <span className="ripple-letter" style={{ '--i': 7 }}>p</span>
            <span className="ripple-letter" style={{ '--i': 8 }}>p</span>
            <span className="ripple-letter" style={{ '--i': 9 }}>l</span>
            <span className="ripple-letter" style={{ '--i': 10 }}>e</span>
          </h1>
        </div>
        <div className="header-content">
          <button className="menu-button" onClick={() => setShowMenu(true)}>
            <span className="menu-icon">☰</span>
            Menu
          </button>
        </div>
        <p>Generate URL combinations from word lists</p>
      </header>

      <main>
        <div className="lists-container">
          <div className="word-list">
            <div className="list-header">
              <h3>First Word</h3>
            </div>
            <select 
              onChange={(e) => handleListSelect('first', e.target.value)}
              value={selectedLists.first?.id || ''}
            >
              <option value="">Select existing list...</option>
              {wordLists.map(list => (
                <option key={list.id} value={list.id}>{list.name}</option>
              ))}
            </select>
            {selectedLists.first && (
              <div className="word-preview">
                <ul>
                  {selectedLists.first.words.slice(0, 5).map((word, index) => (
                    <li key={index}>{capitalize(word)}</li>
                  ))}
                </ul>
                {selectedLists.first.words.length > 5 && (
                  <div className="more-words">
                    +{selectedLists.first.words.length - 5} more words
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="word-list">
            <div className="list-header">
              <h3>Second Word</h3>
            </div>
            <select 
              onChange={(e) => handleListSelect('second', e.target.value)}
              value={selectedLists.second?.id || ''}
            >
              <option value="">Select a list...</option>
              {wordLists.map(list => (
                <option key={list.id} value={list.id}>{list.name}</option>
              ))}
            </select>
            {selectedLists.second && (
              <div className="word-preview">
                <ul>
                  {selectedLists.second.words.slice(0, 5).map((word, index) => (
                    <li key={index}>{capitalize(word)}</li>
                  ))}
                </ul>
                {selectedLists.second.words.length > 5 && (
                  <div className="more-words">
                    +{selectedLists.second.words.length - 5} more words
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="word-list">
            <h3>Domain</h3>
            <select 
              onChange={(e) => handleListSelect('third', e.target.value)}
              value={selectedLists.third?.id || ''}
            >
              <option value="">Select a domain...</option>
              {domainExtensions.map(ext => (
                <option key={ext.id} value={ext.id}>{ext.name}</option>
              ))}
            </select>
            {selectedLists.third && (
              <ul>
                <li>{selectedLists.third.word}</li>
              </ul>
            )}
          </div>
        </div>

        <div className="actions">
          <button className="generate" onClick={generateCombinations}>
            Generate Combinations
          </button>
        </div>

        <div className="results" ref={resultsRef}>
          <div className="results-header">
            <h2>Generated Combinations</h2>
            <div className="results-controls">
              <div className="availability-disclaimer">
                <span className="info-icon">ℹ️</span>
                <span className="disclaimer-text">
                  Domain availability is approximate. Always verify with a registrar.
                </span>
              </div>
              <label className="filter-label">
                <input
                  type="checkbox"
                  checked={showOnlyAvailable}
                  onChange={(e) => setShowOnlyAvailable(e.target.checked)}
                />
                Show only available domains
              </label>
            </div>
          </div>
          <ul>
            {filteredCombinations.map((combo, index) => (
              <li 
                key={index} 
                className="domain-result"
                style={getDomainStyle(combo)}
              >
                <span className="domain-name">
                  {combo}
                </span>
                <span className="domain-status">
                  {checking[combo] ? (
                    <span className="checking-indicator">checking...</span>
                  ) : (
                    <span className="status-text">{getDomainStatusText(combo)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {showListManager && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-header">
                <h2>Manage Word Lists</h2>
                <button className="close-modal" onClick={() => setShowListManager(false)}>×</button>
              </div>
              
              <div className="ai-section">
                <h3>AI Generate Word List</h3>
                <div className="ai-inputs">
                  <input
                    type="text"
                    placeholder="Enter a word to generate related words"
                    value={baseWord}
                    onChange={(e) => setBaseWord(e.target.value)}
                    className="base-word-input"
                  />
                  <button 
                    className="generate-list-button" 
                    onClick={() => generateWordList('first')}
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Generating...' : 'AI Generate'}
                  </button>
                </div>
              </div>

              <div className="section-divider">
                <span>OR</span>
              </div>

              <div className="manual-section">
                <h3>Add New List Manually</h3>
                <div className="list-actions">
                  <input
                    type="text"
                    placeholder="List name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    className="list-name-input"
                  />
                </div>

                <div className="input-methods">
                  <div className="paste-section">
                    <h4>Paste Words</h4>
                    <textarea
                      placeholder="Paste words here, one per line"
                      value={pastedWords}
                      onChange={(e) => setPastedWords(e.target.value)}
                      className="word-paste"
                    />
                  </div>
                  
                  <div className="or-divider">
                    <span>OR</span>
                  </div>

                  <div className="file-section">
                    <h4>Upload File</h4>
                    <input
                      type="file"
                      accept=".txt"
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      className="file-input"
                    />
                    <p className="upload-help">Upload a .txt file with one word per line</p>
                  </div>
                </div>

                <button 
                  className="add-list-button" 
                  onClick={handleAddList}
                  disabled={!newListName.trim() || !pastedWords.trim()}
                >
                  Add List
                </button>
              </div>

              <div className="existing-lists">
                <h3>Existing Lists</h3>
                <ul>
                  {wordLists.map(list => (
                    <li key={list.id} className="list-item">
      <div>
                        <strong>{list.name}</strong>
                        <span className="word-count">({list.words.length} words)</span>
                      </div>
                      <button 
                        className="delete-list"
                        onClick={() => deleteList(list.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {showMenu && (
          <div className="modal-overlay">
            <div className="modal menu-modal">
              <div className="modal-header">
                <h2>Menu</h2>
                <button className="close-modal" onClick={() => setShowMenu(false)}>×</button>
      </div>
              
              <div className="menu-items">
                <button 
                  className="menu-item"
                  onClick={() => {
                    setShowMenu(false)
                    setShowListManager(true)
                  }}
                >
                  <span className="menu-item-icon">📝</span>
                  Manage Word Lists
        </button>
              </div>
            </div>
          </div>
        )}
      </main>
      </div>
  )
}

export default App
